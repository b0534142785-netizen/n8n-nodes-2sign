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

export class TwoSignTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'חתימה ירוקה - כשמשהו קורה',
		name: 'twoSignTrigger',
		icon: { light: 'file:twosign.svg', dark: 'file:twosign.dark.svg' },
		group: ['trigger'],
		subtitle: '={{$parameter["event"]}}',
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
		],
		properties: [
			{
				displayName:
					'איך מחברים: מעתיקים את הכתובת שלמעלה (Production URL), ובחתימה ירוקה נכנסים ל: מנוי ← הגדרות ← הגדרות חשבון ← הגדרות מתקדמות ← הגדרות API נוספות. מדביקים את הכתובת ושומרים. אפשר להגדיר כתובת נפרדת גם לכל תבנית. הכתובת חייבת להתחיל ב-https.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'מתי להמשיך',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'בכל הודעה',
						value: 'all',
					},
					{
						name: 'רק כשאין סיבת סירוב',
						value: 'notDeclined',
						description: 'ההודעות שבהן השדה taskDeclineReason ריק (בדרך כלל: נחתם)',
					},
					{
						name: 'רק כשהחותם סירב',
						value: 'declined',
						description: 'ההודעות שבהן יש סיבת סירוב (taskDeclineReason)',
					},
				],
				default: 'all',
				description:
					'בתיעוד של חתימה ירוקה אין רשימה של סוגי ההודעות, ולכן הסינון לפי סיבת הסירוב בלבד',
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
		const event = this.getNodeParameter('event', 'all') as string;
		const query = this.getQueryData() as IDataObject;
		const res = this.getResponseObject();

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

		const declined =
			typeof data.taskDeclineReason === 'string' && data.taskDeclineReason.trim() !== '';
		if ((event === 'declined' && !declined) || (event === 'notDeclined' && declined)) {
			return { webhookResponse: 'OK' };
		}

		return {
			webhookResponse: 'OK',
			workflowData: [this.helpers.returnJsonArray(data)],
		};
	}
}
