// בדיקה בלי אינטרנט: מריצים את הנוד עם שרת מדומה, ובודקים שכל בקשה תואמת את התיעוד של חתימה ירוקה.
// הרצה: node test/offline.test.js (אחרי npm run build)
const assert = require('node:assert/strict');
const { TwoSign } = require('../dist/nodes/TwoSign/TwoSign.node.js');
const { TwoSignTrigger } = require('../dist/nodes/TwoSignTrigger/TwoSignTrigger.node.js');

const CREDS = {
	authMethod: 'client',
	clientId: 'CID',
	clientSecret: 'SECRET',
	baseUrl: 'https://api.2sign.co.il/api/',
};

function makeCtx(params, { items = [{ json: {} }], binary, responder, creds = CREDS } = {}) {
	const calls = [];
	const node = { name: 'חתימה ירוקה', type: 'twoSign', typeVersion: 1, parameters: {} };
	const ctx = {
		calls,
		getInputData: () => items,
		getNode: () => node,
		continueOnFail: () => false,
		getCredentials: async () => creds,
		getNodeParameter: (name, i, fallback) => {
			const p = typeof params === 'function' ? params(i) : params;
			return name in p ? p[name] : fallback;
		},
		helpers: {
			httpRequest: async (req) => {
				calls.push(req);
				return responder(req, calls);
			},
			assertBinaryData: () => binary,
			getBinaryDataBuffer: async () => Buffer.from('%PDF-1.4 test'),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
	return ctx;
}

const defaultResponder = (req) => {
	if (req.url.endsWith('/api/Account/LoginApi')) return JSON.stringify({ access_token: 'TOKEN' });
	if (req.url.endsWith('/UploadFileForTask')) return { PdfGuid: 'PDF-G', TaskGuid: 'TASK-G' };
	if (req.url.includes('CreateTask')) return { Status: 'success', Message: '', ResponseObject: { TaskGuid: 'NEW-G' } };
	return { Status: 'success', Message: '', ResponseObject: [] };
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('התחברות: כתובת נכונה (בלי /api כפול) וגוף לפי התיעוד', async () => {
	const ctx = makeCtx({ resource: 'account', operation: 'taskCount' }, { responder: defaultResponder });
	await new TwoSign().execute.call(ctx);
	const [loginCall, countCall] = ctx.calls;
	assert.equal(loginCall.url, 'https://api.2sign.co.il/api/Account/LoginApi');
	assert.equal(loginCall.method, 'POST');
	assert.deepEqual(loginCall.body, { GrantType: 'client', ClientId: 'CID', ClientSecret: 'SECRET' });
	assert.equal(countCall.url, 'https://api.2sign.co.il/api/V2/BaseTasks/GetTasksCountForMonth');
	assert.equal(countCall.headers.Authorization, 'Bearer TOKEN');
});

test('התחברות במייל וסיסמה', async () => {
	const ctx = makeCtx(
		{ resource: 'group', operation: 'getAll' },
		{
			responder: defaultResponder,
			creds: { authMethod: 'email', email: 'a@b.c', password: 'p', clientId: 'CID', baseUrl: '' },
		},
	);
	await new TwoSign().execute.call(ctx);
	assert.deepEqual(ctx.calls[0].body, { Email: 'a@b.c', Password: 'p' });
	assert.equal(ctx.calls[1].url, 'https://api.2sign.co.il/api/Groups/GetAllByUser');
	assert.equal(ctx.calls[1].method, 'GET');
});

test('התחברות אחת לכמה פריטים', async () => {
	const ctx = makeCtx(
		{ resource: 'client', operation: 'get', clientIdText: '5' },
		{ responder: defaultResponder, items: [{ json: {} }, { json: {} }, { json: {} }] },
	);
	await new TwoSign().execute.call(ctx);
	assert.equal(ctx.calls.filter((c) => c.url.endsWith('LoginApi')).length, 1);
	assert.equal(ctx.calls.length, 4);
	assert.deepEqual(ctx.calls[1].qs, { clientId: '5' });
});

test('קוד 401 גורם להתחברות מחדש פעם אחת', async () => {
	let first = true;
	const ctx = makeCtx(
		{ resource: 'group', operation: 'getAll' },
		{
			responder: (req) => {
				if (req.url.endsWith('LoginApi')) return { access_token: 'T' };
				if (first) {
					first = false;
					const e = new Error('401');
					e.response = { status: 401 };
					throw e;
				}
				return [];
			},
		},
	);
	await new TwoSign().execute.call(ctx);
	assert.equal(ctx.calls.filter((c) => c.url.endsWith('LoginApi')).length, 2);
});

test('משימה מתבנית לנמען חד-פעמי', async () => {
	const ctx = makeCtx(
		{
			resource: 'task',
			operation: 'createFromTemplate',
			templateIds: '4522',
			taskSubject: 'מסמך',
			recipientType: 'contact',
			clientName: 'ישראל',
			clientPhones: '0501234567',
			clientEmails: '',
			sendOnCreation: true,
			sendChannels: ['email', 'whatsapp'],
			options: {
				emailText: 'שלום',
				applyOtp: true,
				secretCode: '1234',
				prefillFields: { field: [{ fieldType: 12, value: 'ישראל ישראלי' }, { fieldType: 4, value: 'a@b.c' }] },
				markerFields: { marker: [{ char: '§', fieldType: 1 }] },
				fixedSignatures: { signature: [{ page: 1, position: 9 }] },
				additionalUserParamsObject: '{"crmId": 77}',
			},
		},
		{ responder: defaultResponder },
	);
	const [out] = await new TwoSign().execute.call(ctx);
	const call = ctx.calls[1];
	assert.equal(call.url, 'https://api.2sign.co.il/api/V2/Tasks/CreateTask');
	assert.deepEqual(call.body, {
		TaskSubject: 'מסמך',
		TemplateId: 4522,
		ClientName: 'ישראל',
		ClientPhones: '0501234567',
		IsSendOnCreation: true,
		IsSendEmailOnCreation: true,
		IsSendSmsOnCreation: false,
		IsSendWhatsAppOnCreation: true,
		EmailText: 'שלום',
		ApplyOTP: true,
		SecretCode: '1234',
		ForceSecretCode: true,
		SignaturePositionsStr: '12-ישראל ישראלי|4-a@b.c',
		SearchWordForMarkingFieldsJson: '[{"fieldSignaturePositionType":"1","fieldSearchChar":"§"}]',
		SignaturesConstValues: '1-9',
		AdditionalUserParamsObject: { crmId: 77 },
	});
	assert.equal(out[0].json.signingUrl, 'https://app.2sign.co.il/he/Clients/DocSignature?guid=NEW-G');
});

test('כמה תבניות במשימה אחת: TemplateIdsList', async () => {
	const ctx = makeCtx(
		{
			resource: 'task',
			operation: 'createFromTemplate',
			templateIds: '4522, 4523,4524',
			taskSubject: 'x',
			recipientType: 'client',
			clientId: 235183,
			sendOnCreation: false,
			options: {},
		},
		{ responder: defaultResponder },
	);
	await new TwoSign().execute.call(ctx);
	const body = ctx.calls[1].body;
	assert.equal(body.TemplateIdsList, '4522,4523,4524');
	assert.equal(body.TemplateId, undefined);
	assert.equal(body.ClientId, 235183);
	assert.equal(body.IsSendOnCreation, false);
	assert.equal(body.IsSendEmailOnCreation, undefined);
});

test('משימה מקובץ: העלאה ואז TasksNew עם שני המזהים', async () => {
	const ctx = makeCtx(
		{
			resource: 'task',
			operation: 'createFromFile',
			binaryPropertyName: 'data',
			taskSubject: 'חוזה',
			recipientType: 'group',
			groupId: 23440,
			sendOnCreation: true,
			sendChannels: ['sms'],
			options: { signaturePositions: '[{"X":1,"Y":2,"Page":1}]' },
		},
		{ responder: defaultResponder, binary: { fileName: 'contract.pdf', mimeType: 'application/pdf' } },
	);
	await new TwoSign().execute.call(ctx);
	const upload = ctx.calls[1];
	assert.equal(upload.url, 'https://api.2sign.co.il/api/V2/BaseTasks/UploadFileForTask');
	assert.ok(Buffer.isBuffer(upload.body), 'גוף שנבנה ביד, בלי FormData');
	const ct = upload.headers['Content-Type'];
	assert.match(ct, /^multipart\/form-data; boundary=/);
	const boundary = ct.split('boundary=')[1];
	const text = upload.body.toString('latin1');
	assert.ok(text.startsWith(`--${boundary}\r\n`));
	assert.match(text, /name="Name"\r\n\r\nfileUpload\r\n/);
	assert.match(text, /name="FileName"; filename="contract\.pdf"/);
	assert.match(text, /Content-Type: application\/pdf\r\n\r\n%PDF-1\.4 test\r\n/);
	assert.ok(text.endsWith(`--${boundary}--\r\n`));
	assert.equal(upload.json, undefined);
	assert.equal(upload.headers.Authorization, 'Bearer TOKEN');
	const create = ctx.calls[2];
	// TasksNew/CreateTask שבתיעוד לא קיימת (404). נבדק מול השרת: Tasks/CreateTask עובדת גם לקובץ.
	assert.equal(create.url, 'https://api.2sign.co.il/api/V2/Tasks/CreateTask');
	assert.equal(create.body.TaskGuid, 'TASK-G');
	assert.equal(create.body.PdfGuid, 'PDF-G');
	assert.equal(create.body.GroupId, 23440);
	assert.deepEqual(create.body.SignaturePositions, [{ X: 1, Y: 2, Page: 1 }]);
});

test('נמען חד-פעמי בלי טלפון ובלי מייל נעצר עם הסבר', async () => {
	const ctx = makeCtx(
		{
			resource: 'task',
			operation: 'createFromTemplate',
			templateIds: '1',
			taskSubject: 'x',
			recipientType: 'contact',
			clientPhones: '',
			clientEmails: '',
			sendOnCreation: false,
		},
		{ responder: defaultResponder },
	);
	await assert.rejects(() => new TwoSign().execute.call(ctx), /טלפון או מייל/);
});

test('סבב חתימות לפי סימנים, חותם שמור וחותם חד-פעמי', async () => {
	const ctx = makeCtx(
		{
			resource: 'routine',
			operation: 'createFromFile',
			binaryPropertyName: 'data',
			taskSubject: 'סבב',
			signingOrder: 'sequential',
			groupId: 0,
			fieldsMode: 'markers',
			signers: {
				signer: [
					{ marker: '###', inputType: 0, clientId: 686185 },
					{ marker: '@@@', inputType: 0, clientId: 0, clientName: 'דנה', clientEmails: 'd@x.com' },
				],
			},
			sendOnCreation: true,
			sendChannels: ['email'],
			options: { language: 1, languageMarked: 'he' },
		},
		{ responder: defaultResponder, binary: { fileName: 'a.pdf', mimeType: 'application/pdf' } },
	);
	await new TwoSign().execute.call(ctx);
	const create = ctx.calls[2];
	assert.equal(create.url, 'https://api.2sign.co.il/api/v2/GroupTasks/CreateTask');
	assert.equal(create.body.SignatureRoutine, true);
	assert.equal(create.body.SignatureRoutineAsync, false);
	assert.equal(create.body.GroupId, undefined);
	assert.equal(create.body.Language, 1);
	assert.equal(create.body.LanguageMarked, 'he');
	assert.deepEqual(create.body.SearchWordForSignatureRoutine, [
		{ ClientId: 686185, SearchCharSignature: '###', SignaturePositionFieldType: 0, SignerNumberInRoutine: 1, ClientPhones: null, ClientEmails: null },
		{ ClientId: null, SearchCharSignature: '@@@', SignaturePositionFieldType: 0, SignerNumberInRoutine: 2, ClientPhones: null, ClientEmails: 'd@x.com', ClientName: 'דנה' },
	]);
});

test('סבב מתבנית עם קבוצה, במקביל, לפי שדות התבנית', async () => {
	const ctx = makeCtx(
		{
			resource: 'routine',
			operation: 'createFromTemplate',
			templateIds: '1612',
			taskSubject: 'x',
			signingOrder: 'parallel',
			groupId: 30928,
			fieldsMode: 'template',
			sendOnCreation: true,
			sendChannels: ['email'],
			options: {},
		},
		{ responder: defaultResponder },
	);
	await new TwoSign().execute.call(ctx);
	const b = ctx.calls[1].body;
	assert.equal(b.TemplateId, 1612);
	assert.equal(b.GroupId, 30928);
	assert.equal(b.SignatureRoutineAsync, true);
	assert.equal(b.SignaturePositions, undefined);
});

test('שליחה מחדש, קבלת פרטים, מחיקה והסרת חותם', async () => {
	const cases = [
		[{ resource: 'task', operation: 'resend', taskGuid: 'G', resendChannels: ['sms'], emailSubject: '' }, 'GET', '/api/V2/Tasks/ResendTask', { taskGuid: 'G', resendPhone: true, resendEmail: false, resendWhatsapp: false }],
		[{ resource: 'task', operation: 'get', taskGuid: ' G ' }, 'GET', '/api/V2/BaseTasks/GetTaskByGuid', { guid: 'G' }],
		[{ resource: 'routine', operation: 'get', taskGuid: 'G' }, 'GET', '/api/GroupTasks/GetTaskByGuid', { guid: 'G' }],
		[{ resource: 'task', operation: 'delete', taskGuid: 'G' }, 'POST', '/api/V2/BaseTasks/DeleteTaskByGuid', { guid: 'G' }],
		[{ resource: 'routine', operation: 'deleteSigner', taskGuid: 'G' }, 'POST', '/api/V2/BaseTasks/DeleteTaskClientByGuid', { guid: 'G' }],
		[{ resource: 'group', operation: 'get', groupIdValue: 9 }, 'POST', '/api/Groups/GetById', { groupId: 9 }],
		[{ resource: 'template', operation: 'get', templateId: 1612 }, 'GET', '/api/v2/Templates/GetTemplateById', { token: 'CID', id: 1612, templateid: 1612 }],
		[{ resource: 'template', operation: 'search', templateSearch: { templateName: 'חוזה', templateId: 0 } }, 'GET', '/api/v2/Templates/GetTemplateBySearchParams', { templateName: 'חוזה', token: 'CID' }],
	];
	for (const [params, method, path, qs] of cases) {
		const ctx = makeCtx(params, { responder: defaultResponder });
		await new TwoSign().execute.call(ctx);
		const call = ctx.calls[1];
		assert.equal(call.method, method, path);
		assert.equal(call.url, 'https://api.2sign.co.il' + path);
		assert.deepEqual(call.qs, qs, path);
	}
});

test('קישור לחתימה בלי לפנות לשירות', async () => {
	const ctx = makeCtx({ resource: 'task', operation: 'signingLink', taskGuid: 'ABC' }, { responder: defaultResponder });
	const [out] = await new TwoSign().execute.call(ctx);
	assert.equal(ctx.calls.length, 0);
	assert.equal(out[0].json.signingUrl, 'https://app.2sign.co.il/he/Clients/DocSignature?guid=ABC');
});

test('לקוחות וקבוצות: גוף הבקשה', async () => {
	let ctx = makeCtx({ resource: 'client', operation: 'delete', clientIds: '123456, 789012' }, { responder: defaultResponder });
	await new TwoSign().execute.call(ctx);
	assert.deepEqual(ctx.calls[1].body, { Clients: [{ ClientId: 123456 }, { ClientId: 789012 }] });

	ctx = makeCtx({ resource: 'group', operation: 'addClients', groupIdValue: 23157, groupClientIds: '201482' }, { responder: defaultResponder });
	await new TwoSign().execute.call(ctx);
	assert.deepEqual(ctx.calls[1].body, { Id: 23157, GroupClients: [{ GroupId: 23157, ClientId: 201482 }] });

	ctx = makeCtx({ resource: 'client', operation: 'create', name: 'בדיקה', emails: 't@t.com', phones: '', compNum: '' }, { responder: defaultResponder });
	await new TwoSign().execute.call(ctx);
	assert.deepEqual(ctx.calls[1].body, { Name: 'בדיקה', Emails: 't@t.com' });

	ctx = makeCtx({ resource: 'client', operation: 'search', clientSearch: { Phones: '050' } }, { responder: (req) => req.url.endsWith('LoginApi') ? { access_token: 'T' } : [{ Id: 1 }, { Id: 2 }] });
	const [out] = await new TwoSign().execute.call(ctx);
	assert.equal(out.length, 2, 'רשימה הופכת לכמה פריטים');
});

test('מסמך חתום כקובץ: Base64 הופך לקובץ PDF', async () => {
	const pdf = Buffer.from('%PDF-1.7 signed').toString('base64');
	const ctx = makeCtx(
		{ resource: 'document', operation: 'get', documentType: 'signed', taskGuid: 'G', outputMode: 'file', isRoutine: true, outputBinaryName: 'data', documentOptions: {} },
		{
			responder: (req) => req.url.endsWith('LoginApi') ? { access_token: 'T' } : { Status: 'success', Message: '', ResponseObject: { TaskGuid: 'G', IsSigned: true, SignedTaskLinkBlob: '', SignedTaskFile: '', SignedTaskBase64File: pdf } },
		},
	);
	const [out] = await new TwoSign().execute.call(ctx);
	assert.equal(ctx.calls[1].url, 'https://api.2sign.co.il/api/V2/GroupTasks/GetSignedTaskLocationBlob');
	assert.deepEqual(ctx.calls[1].qs, { guid: 'G', fileDownloadType: 2 });
	assert.equal(out[0].binary.data.fileName, 'signed.pdf');
	assert.equal(out[0].binary.data.mimeType, 'application/pdf');
	assert.equal(out[0].json.SignedTaskBase64File, undefined);
});

test('מסמך כקישור, וקובץ שחסר', async () => {
	let ctx = makeCtx(
		{ resource: 'document', operation: 'get', documentType: 'idCard', taskGuid: 'G', outputMode: 'link', documentOptions: { taskId: 5 } },
		{ responder: (req) => req.url.endsWith('LoginApi') ? { access_token: 'T' } : { Status: 'success', Message: 'https://blob/x.png', ResponseObject: { IdCardAttachmentLinkBlob: 'https://blob/x.png' } } },
	);
	let [out] = await new TwoSign().execute.call(ctx);
	assert.equal(ctx.calls[1].url, 'https://api.2sign.co.il/api/V2/BaseTasks/GetIdAttachmentLocationBlob');
	assert.deepEqual(ctx.calls[1].qs, { guid: 'G', fileDownloadType: 0, taskId: 5 });
	assert.equal(out[0].json.idCardUrl, 'https://blob/x.png');

	ctx = makeCtx(
		{ resource: 'document', operation: 'get', documentType: 'all', taskGuid: 'G', outputMode: 'file', outputBinaryName: 'data', documentOptions: {} },
		{ responder: (req) => req.url.endsWith('LoginApi') ? { access_token: 'T' } : { Status: 'success', ResponseObject: { OriginalBase64File: Buffer.from('%PDF').toString('base64') } } },
	);
	[out] = await new TwoSign().execute.call(ctx);
	assert.deepEqual(Object.keys(out[0].binary), ['original']);
	assert.deepEqual(out[0].json.missingFiles, ['signed', 'idCard', 'general', 'excel']);
});

test('שגיאה מפורשת מהשירות עוצרת עם ההודעה שלו', async () => {
	const ctx = makeCtx({ resource: 'group', operation: 'getAll' }, { responder: (req) => req.url.endsWith('LoginApi') ? { access_token: 'T' } : { Status: 'error', Message: 'אין הרשאה' } });
	await assert.rejects(() => new TwoSign().execute.call(ctx), /אין הרשאה/);
});

test('התחברות בלי מפתח גישה נעצרת עם הסבר', async () => {
	const ctx = makeCtx({ resource: 'group', operation: 'getAll' }, { responder: () => 'token wasnt created' });
	await assert.rejects(() => new TwoSign().execute.call(ctx), /ההתחברות לחתימה ירוקה נכשלה/);
});

// ===== תשובות אמיתיות שנבדקו מול השרת (24.11.2026) =====
const realLogin = { Status: 'success', Message: '', MessageID: 0, ResponseObject: { Email: 'x@y.z', access_token: 'REAL' } };

test('אמיתי: מפתח הגישה בתוך ResponseObject', async () => {
	const ctx = makeCtx({ resource: 'task', operation: 'signingLink', taskGuid: 'G' }, { responder: () => realLogin });
	// signingLink לא מתחבר, אז בודקים עם פעולה אחרת
	const ctx2 = makeCtx({ resource: 'group', operation: 'get', groupIdValue: 1 }, {
		responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'success', ResponseObject: null }),
	});
	const [out] = await new TwoSign().execute.call(ctx2);
	assert.equal(ctx2.calls[1].headers.Authorization, 'Bearer REAL');
	assert.equal(out.length, 0, 'ResponseObject ריק = אין פריטים');
	assert.ok(ctx);
});

test('אמיתי: סוד שגוי (200 עם failure) נעצר עם הסבר', async () => {
	const ctx = makeCtx({ resource: 'group', operation: 'getAll' }, {
		responder: () => ({ Status: 'failure', Message: 'token wasnt created', MessageID: 0, ResponseObject: null }),
	});
	await assert.rejects(() => new TwoSign().execute.call(ctx), /המזהה או הסוד לא נכונים/);
});

test('אמיתי: אין קבוצות (failed + 19) = רשימה ריקה, לא שגיאה', async () => {
	const ctx = makeCtx({ resource: 'group', operation: 'getAll' }, {
		responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'failed', Message: '', MessageID: 0, ResponseObject: { Id: 0, GroupClients: [], APIResponse: [19] } }),
	});
	const [out] = await new TwoSign().execute.call(ctx);
	assert.equal(out.length, 0);
});

test('אמיתי: משימה שלא קיימת (23) נעצרת בהודעה בעברית', async () => {
	const ctx = makeCtx({ resource: 'task', operation: 'get', taskGuid: 'X' }, {
		responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'failed', Message: null, MessageID: 23, MessageDescription: 'TaskNotFoundByGuid', ResponseObject: { APIResponse: [23] } }),
	});
	await assert.rejects(() => new TwoSign().execute.call(ctx), /המשימה לא נמצאה/);
});

test('אמיתי: חיפוש משימות שולח Token, ומחזיר רשימה נקייה', async () => {
	const ctx = makeCtx({ resource: 'task', operation: 'search', filters: {} }, {
		responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'success', ResponseObject: [{ TaskGuid: 'A', TaskSubject: 'x', PdfGuid: null, SignaturePositions: [] }, { TaskGuid: 'B' }] }),
	});
	const [out] = await new TwoSign().execute.call(ctx);
	assert.deepEqual(ctx.calls[1].body, { Token: 'CID' });
	assert.equal(out.length, 2);
	assert.deepEqual(out[0].json, { TaskGuid: 'A', TaskSubject: 'x' });
});

test('אמיתי: חיפוש לקוחות בלי שדה נעצר לפני ששולחים', async () => {
	const ctx = makeCtx({ resource: 'client', operation: 'search', clientSearch: {} }, { responder: () => realLogin });
	await assert.rejects(() => new TwoSign().execute.call(ctx), /לפחות שדה אחד/);
	assert.equal(ctx.calls.length, 0);
});

test('אמיתי: ספירת משימות מחזירה רק את המספר', async () => {
	const ctx = makeCtx({ resource: 'account', operation: 'taskCount' }, {
		responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'success', ResponseObject: { TasksCount: 1, TasksQuotaLeft: null, Language: 1, TaskStatusNumeric: 2 } }),
	});
	const [out] = await new TwoSign().execute.call(ctx);
	assert.deepEqual(out[0].json, { tasksThisMonth: 1 });
});

test('אמיתי: תקלת שרת (500) בלי הפירוט הפנימי שלהם', async () => {
	const ctx = makeCtx({ resource: 'template', operation: 'get', templateId: 1 }, {
		responder: (req) => {
			if (req.url.endsWith('LoginApi')) return realLogin;
			const e = new Error('500');
			e.response = { status: 500, data: { Message: 'An error has occurred.', ExceptionMessage: 'Object reference not set to an instance of an object.', StackTrace: 'at Signature.Web...' } };
			throw e;
		},
	});
	await assert.rejects(() => new TwoSign().execute.call(ctx), (err) => {
		assert.match(err.description, /תקלה בשרת של חתימה ירוקה/);
		assert.doesNotMatch(err.description, /Signature\.Web/);
		return true;
	});
});

test('אמיתי: מסמך מקורי כקובץ, כשגם BlobFile וגם Base64File מלאים', async () => {
	const b64 = Buffer.from('%PDF-1.4 original').toString('base64');
	const ctx = makeCtx(
		{ resource: 'document', operation: 'get', documentType: 'original', taskGuid: 'G', outputMode: 'file', outputBinaryName: 'data', documentOptions: {} },
		{ responder: (req) => (req.url.endsWith('LoginApi') ? realLogin : { Status: 'success', Message: 'https://2signdocuments.blob.core.windows.net/prod/x.pdf', ResponseObject: { TaskGuid: 'G', IsSigned: true, OriginalTaskLinkBlob: 'https://blob/x.pdf', OriginalBlobFile: b64, OriginalBase64File: b64 } }) },
	);
	const [out] = await new TwoSign().execute.call(ctx);
	assert.equal(out[0].binary.data.fileName, 'original.pdf');
	assert.equal(out[0].json.OriginalBase64File, undefined);
	assert.equal(out[0].json.OriginalBlobFile, undefined);
	assert.equal(out[0].json.IsSigned, true);
});

// ===== הנוד שמתחיל תהליך =====
function makeWebhookCtx(params, body, query = {}, webhookName = 'default') {
	const sent = {};
	return {
		sent,
		getWebhookName: () => webhookName,
		getNodeParameter: (n, fallback) => (n in params ? params[n] : fallback),
		getQueryData: () => query,
		getBodyData: () => body,
		getResponseObject: () => ({ status: (s) => ({ send: (t) => { sent.status = s; sent.text = t; } }) }),
		helpers: { returnJsonArray: (d) => [{ json: d }] },
	};
}

test('הודעה אוטומטית: פענוח signaturePositions ו-AdditionalParams', async () => {
	const positions = Buffer.from(JSON.stringify([{ X: 1 }])).toString('base64');
	const ctx = makeWebhookCtx({ event: 'all', secret: '' }, {
		taskId: '7386051', taskGuid: 'G1', isTaskGroup: 'false', taskDeclineReason: '', signaturePositions: positions, AdditionalParams: '{"crmId":77}',
	});
	const res = await new TwoSignTrigger().webhook.call(ctx);
	// התשובה לחתימה ירוקה נשלחת ישירות: 200 עם OK (n8n מתעלם מ-webhookResponse)
	assert.equal(ctx.sent.status, 200);
	assert.equal(ctx.sent.text, 'OK');
	assert.equal(res.noWebhookResponse, true);
	const data = res.workflowData[0][0].json;
	assert.deepEqual(data.signaturePositions, [{ X: 1 }]);
	assert.deepEqual(data.AdditionalParams, { crmId: 77 });
	assert.equal(data.isTaskGroup, false);
	assert.equal(data.signingUrl, 'https://app.2sign.co.il/he/Clients/DocSignature?guid=G1');
});

test('אמיתי: בדיקת הכתובת של חתימה ירוקה (GET) עונה OK ולא מפעילה את התהליך', async () => {
	const { TwoSignTrigger: T } = require('../dist/nodes/TwoSignTrigger/TwoSignTrigger.node.js');
	const methods = new T().description.webhooks.map((w) => `${w.name}:${w.httpMethod}:${w.path}`);
	assert.deepEqual(methods, ['default:POST:webhook', 'setup:GET:webhook']);
	const ctx = makeWebhookCtx({ event: 'all', secret: 'abc' }, {}, {}, 'setup');
	const res = await new T().webhook.call(ctx);
	assert.equal(ctx.sent.status, 200);
	assert.equal(ctx.sent.text, 'OK');
	assert.equal(res.workflowData, undefined);
});

test('הודעה אוטומטית: מפתח סודי וסינון סירוב', async () => {
	let ctx = makeWebhookCtx({ event: 'all', secret: 'abc' }, { taskGuid: 'G' }, { key: 'wrong' });
	let res = await new TwoSignTrigger().webhook.call(ctx);
	assert.equal(res.noWebhookResponse, true);
	assert.equal(ctx.sent.status, 401);

	ctx = makeWebhookCtx({ event: 'declined', secret: 'abc' }, { taskGuid: 'G', taskDeclineReason: '' }, { key: 'abc' });
	res = await new TwoSignTrigger().webhook.call(ctx);
	assert.equal(res.workflowData, undefined);
	assert.equal(ctx.sent.status, 200);
	assert.equal(ctx.sent.text, 'OK');

	ctx = makeWebhookCtx({ event: 'declined', secret: '' }, { taskGuid: 'G', taskDeclineReason: 'לא מסכים' });
	res = await new TwoSignTrigger().webhook.call(ctx);
	assert.equal(res.workflowData[0][0].json.taskDeclineReason, 'לא מסכים');
});

(async () => {
	let failed = 0;
	for (const t of tests) {
		try {
			await t.fn();
			console.log('✓', t.name);
		} catch (e) {
			failed++;
			console.log('✗', t.name, '\n   ', e.message);
		}
	}
	console.log(`\n${tests.length - failed}/${tests.length} עברו`);
	process.exit(failed ? 1 : 0);
})();
