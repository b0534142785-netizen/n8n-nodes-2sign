import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

const SIGNING_URL = 'https://app.2sign.co.il/he/Clients/DocSignature?guid=';

function decodeBase64Json(value: unknown): unknown {
	if (typeof value !== 'string' || !value.trim()) return value;
	try {
		const text = Buffer.from(value.trim(), 'base64').toString('utf8');
		return JSON.parse(text);
	} catch {
		return value;
	}
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string' || !value.trim()) return value;
	const text = value.trim();
	if (!text.startsWith('{') && !text.startsWith('[')) return value;
	try {
		return JSON.parse(text);
	} catch {
		return value;
	}
}

/**
 * איזו הודעה הגיעה. בהודעה עצמה אין שדה כזה, אז מזהים לפי השדות (נבדק מול השרת, 24.11.2026):
 * - נפתח: יש viewedOn.
 * - נחתם או סירב: יש taskDeclineReason (ריק = נחתם, מלא = סירב), וגם taskId.
 * - נוצרה משימה: לא נבדק (לא נשלחה כשהמשימה נוצרה מהאתר). כל השאר.
 * אפשר גם לקבוע ידנית, עם ?event=signed בסוף הכתובת.
 */
export function detectEvent(body: IDataObject, query: IDataObject = {}): string {
	const fromQuery = String(query.event ?? '').toLowerCase();
	if (['signed', 'declined', 'viewed', 'created'].includes(fromQuery)) {
		if (fromQuery === 'signed' && String(body.taskDeclineReason ?? '').trim()) return 'declined';
		return fromQuery;
	}
	if (body.viewedOn) return 'viewed';
	if ('taskDeclineReason' in body) {
		return String(body.taskDeclineReason ?? '').trim() ? 'declined' : 'signed';
	}
	return 'created';
}

export class TwoSignTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'חתימה ירוקה - כשמשהו קורה',
		name: 'twoSignTrigger',
		icon: { light: 'file:twosign.svg', dark: 'file:twosign.dark.svg' },
		group: ['trigger'],
		subtitle: '={{$parameter["events"].join(", ")}}',
		version: 1,
		description: 'מתחיל תהליך כשחתימה ירוקה שולחת הודעה אוטומטית: מסמך נחתם או שמצב המשימה השתנה',
		defaults: { name: 'חתימה ירוקה - כשמשהו קורה' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
			// חתימה ירוקה בודקים שהכתובת זמינה לפני שהם שומרים אותה, בבקשת HEAD (נבדק 24.11.2026:
			// בלי זה השמירה נכשלת ב"לא ניתן להגיע לכתובת"). עונים OK, בלי להפעיל את התהליך.
			// GET נשאר למקרה שבודקים את הכתובת בדפדפן.
			{
				name: 'setup',
				httpMethod: 'HEAD',
				responseMode: 'onReceived',
				path: 'webhook',
			},
			{
				name: 'setup',
				httpMethod: 'GET',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'איך מחברים: מפרסמים את התהליך, ומעתיקים את הכתובת שלמעלה (Production URL). בחתימה ירוקה: הגדרות ← API ← הגדרות API נוספות. יש שם שלוש כתובות: לאחר הקמת משימה, לאחר חיתום, ועבור מסמך נצפה. מדביקים את אותה כתובת בשלושתן (או רק במה שצריך) ושומרים. הנוד מזהה לבד איזו הודעה הגיעה.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'על מה להפעיל את התהליך',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: 'המסמך נחתם',
						value: 'signed',
					},
					{
						name: 'החותם סירב לחתום',
						value: 'declined',
					},
					{
						name: 'החותם פתח את המסמך',
						value: 'viewed',
					},
					{
						name: 'נוצרה משימה',
						value: 'created',
						description:
							'לא נשלחת כשיוצרים משימה מהאתר של חתימה ירוקה (נבדק). כנראה רק כשיוצרים דרך ה-API.',
					},
				],
				default: ['signed', 'declined', 'viewed', 'created'],
				description: 'סוג ההודעה נכתב גם בשדה event שיוצא מהנוד',
			},
			{
				displayName: 'מפתח סודי בכתובת (לא חובה)',
				name: 'secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'שמירה מפני הודעות מזויפות. אם ממלאים, מוסיפים לכתובת בחתימה ירוקה בסוף ?key=המפתח. הודעה בלי המפתח הנכון לא תפעיל את התהליך.',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const secret = this.getNodeParameter('secret', '') as string;
		const events = this.getNodeParameter('events', []) as string[];
		const query = this.getQueryData() as IDataObject;
		const res = this.getResponseObject();

		// בדיקת הכתובת של חתימה ירוקה (GET): רק עונים שהכתובת עובדת
		if (this.getWebhookName() === 'setup') {
			res.status(200).send('OK');
			return { noWebhookResponse: true };
		}

		if (secret && String(query.key ?? '') !== secret) {
			res.status(401).send('Unauthorized');
			return { noWebhookResponse: true };
		}

		const raw = (this.getBodyData() ?? {}) as IDataObject;
		const data: IDataObject = { ...raw };

		if (data.signaturePositions !== undefined) {
			data.signaturePositions = decodeBase64Json(data.signaturePositions) as IDataObject;
		}
		for (const key of ['AdditionalParams', 'AdditionalUserParamsObject', 'additionalParams']) {
			if (data[key] !== undefined) data[key] = parseJson(data[key]) as IDataObject;
		}
		if (typeof data.isTaskGroup === 'string') {
			data.isTaskGroup = data.isTaskGroup.toLowerCase() === 'true';
		}
		if (typeof data.taskGuid === 'string' && data.taskGuid) {
			data.signingUrl = SIGNING_URL + data.taskGuid;
		}

		// חתימה ירוקה מצפה לתשובה 200 עם הטקסט OK. עונים ישירות, כי n8n מתעלם מ-webhookResponse
		// כשהתשובה נשלחת מיד עם הקבלה (נבדק 24.11.2026: חזר "firstEntryJson" במקום "OK").
		res.status(200).send('OK');

		const event = detectEvent(raw, query);
		data.event = event;
		if (events.length && !events.includes(event)) {
			return { noWebhookResponse: true };
		}

		return {
			noWebhookResponse: true,
			workflowData: [this.helpers.returnJsonArray(data)],
		};
	}
}
