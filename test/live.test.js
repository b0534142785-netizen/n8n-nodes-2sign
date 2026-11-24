// בדיקה מול חתימה ירוקה האמיתית. קוראת את פרטי החיבור מ-.env.
// הרצה: node test/live.test.js (אחרי npm run build)
// משימת בדיקה נוצרת רק אם יש TWOSIGN_TEST_EMAIL. היא לא נשלחת לאף אחד, ונמחקת בסוף.
const fs = require('node:fs');
const path = require('node:path');
const { TwoSign } = require('../dist/nodes/TwoSign/TwoSign.node.js');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
	const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.TWOSIGN_CLIENT_ID || !env.TWOSIGN_CLIENT_SECRET) {
	console.log('חסרים המזהה או הסוד בקובץ .env');
	process.exit(1);
}
const SECRETS = [env.TWOSIGN_CLIENT_SECRET];
const mask = (text) => {
	let t = String(text);
	for (const s of SECRETS) if (s) t = t.split(s).join('***');
	return t.replace(/Bearer [A-Za-z0-9._\-]+/g, 'Bearer ***').replace(/"access_token":"[^"]+"/g, '"access_token":"***"');
};

const CREDS = {
	authMethod: 'client',
	clientId: env.TWOSIGN_CLIENT_ID,
	clientSecret: env.TWOSIGN_CLIENT_SECRET,
	baseUrl: 'https://api.2sign.co.il',
};

const log = [];

// כמו httpRequest של n8n: qs, json, FormData, ושגיאה עם response כשהקוד לא 2xx
async function httpRequest(req) {
	const url = new URL(req.url);
	for (const [k, v] of Object.entries(req.qs || {})) if (v !== undefined) url.searchParams.set(k, String(v));
	const headers = { ...(req.headers || {}) };
	let body;
	if (req.body instanceof FormData) body = req.body;
	else if (req.body !== undefined) {
		body = JSON.stringify(req.body);
		headers['Content-Type'] = 'application/json';
	}
	const res = await fetch(url, { method: req.method, headers, body });
	const text = await res.text();
	let data = text;
	try {
		data = JSON.parse(text);
	} catch {}
	const shownBody = req.body instanceof FormData ? '[קובץ]' : req.body;
	const masked = mask(JSON.stringify(data));
	log.push({
		request: mask(`${req.method} ${url.pathname}${url.search}`),
		body: shownBody && JSON.parse(mask(JSON.stringify(shownBody))),
		status: res.status,
		response: masked.length > 4000 ? masked.slice(0, 4000) + '…' : JSON.parse(masked),
	});
	if (!res.ok) {
		const e = new Error(`HTTP ${res.status}`);
		e.response = { status: res.status, data };
		throw e;
	}
	return data;
}

function ctxFor(params, binary) {
	return {
		getInputData: () => [{ json: {} }],
		getNode: () => ({ name: 'חתימה ירוקה', type: 'twoSign', typeVersion: 1, parameters: {} }),
		continueOnFail: () => false,
		getCredentials: async () => CREDS,
		getNodeParameter: (n, _i, fallback) => (n in params ? params[n] : fallback),
		helpers: {
			httpRequest,
			assertBinaryData: () => binary,
			getBinaryDataBuffer: async () => binary.buffer,
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ fileName, mimeType, size: buffer.length }),
		},
	};
}

// PDF קטן של עמוד אחד, עם סימן ### למקום החתימה
function tinyPdf() {
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		null,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	const stream = 'BT /F1 18 Tf 72 760 Td (2Sign n8n node test) Tj 0 -60 Td (Sign here: ###) Tj ET';
	objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
	let pdf = '%PDF-1.4\n';
	const offsets = [];
	objs.forEach((o, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

const results = [];
async function step(name, params, binary) {
	const start = log.length;
	try {
		const [out] = await new TwoSign().execute.call(ctxFor(params, binary));
		results.push({ step: name, ok: true, items: out.length });
		console.log('✓', name, `(${out.length} פריטים)`);
		return out;
	} catch (e) {
		const msg = mask(`${e.message}${e.description ? ' | ' + e.description : ''}`);
		results.push({ step: name, ok: false, error: msg });
		console.log('✗', name, '\n   ', msg.slice(0, 500));
		return null;
	} finally {
		results[results.length - 1].calls = log.slice(start);
	}
}

(async () => {
	await step('ספירת משימות החודש (כולל התחברות)', { resource: 'account', operation: 'taskCount' });
	await step('כל הקבוצות', { resource: 'group', operation: 'getAll' });
	await step('חיפוש תבניות', { resource: 'template', operation: 'search', templateSearch: {} });
	if (env.TWOSIGN_TEMPLATE_ID) {
		await step('תבנית לפי מספר', { resource: 'template', operation: 'get', templateId: Number(env.TWOSIGN_TEMPLATE_ID) });
	}
	await step('חיפוש לקוחות לפי מייל', { resource: 'client', operation: 'search', clientSearch: { Emails: env.TWOSIGN_TEST_EMAIL || 'no-such@example.com' } });
	await step('חיפוש משימות', { resource: 'task', operation: 'search', filters: {} });

	// יצירת משימה עלולה להיספר במכסת המסמכים, ולכן רק עם --create במפורש
	if (env.TWOSIGN_TEST_EMAIL && process.argv.includes('--create')) {
		const created = await step(
			'משימה מקובץ (בלי שליחה)',
			{
				resource: 'task',
				operation: 'createFromFile',
				binaryPropertyName: 'data',
				taskSubject: 'בדיקה של הנוד ל-n8n (אפשר למחוק)',
				recipientType: 'contact',
				clientName: 'בדיקה',
				clientEmails: env.TWOSIGN_TEST_EMAIL,
				clientPhones: '',
				sendOnCreation: false,
				options: { searchWordForMarkingSignature: '###' },
			},
			{ fileName: 'test.pdf', mimeType: 'application/pdf', buffer: tinyPdf() },
		);
		const guid = created && created[0].json.taskGuid;
		if (guid) {
			console.log('   קישור לחתימה:', created[0].json.signingUrl);
			await step('פרטי המשימה', { resource: 'task', operation: 'get', taskGuid: guid });
			await step('המסמך המקורי כקובץ', { resource: 'document', operation: 'get', documentType: 'original', taskGuid: guid, outputMode: 'file', outputBinaryName: 'data', documentOptions: {} });
			await step('המסמך המקורי כקישור', { resource: 'document', operation: 'get', documentType: 'original', taskGuid: guid, outputMode: 'link', documentOptions: {} });
			await step('מחיקת משימת הבדיקה', { resource: 'task', operation: 'delete', taskGuid: guid });
		} else if (created) {
			console.log('   לא חזר מזהה משימה, אז לא מחקתי. כדאי לבדוק בחשבון.');
		}
	} else {
		console.log('- דילגתי על יצירת משימה (צריך מייל בקובץ, וגם --create)');
	}

	fs.writeFileSync(path.join(__dirname, '.live-results.json'), JSON.stringify(results, null, 2));
	const failed = results.filter((r) => !r.ok).length;
	console.log(`\n${results.length - failed}/${results.length} עברו. הפירוט: test/.live-results.json`);
})();
