import type {
	ICredentialDataDecryptedObject,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const SIGNING_URL = 'https://app.2sign.co.il/he/Clients/DocSignature?guid=';

/** כתובת השרת, בלי "/" בסוף ובלי "/api" (כל הנתיבים בתיעוד כבר מתחילים ב-/api/). */
export function getBaseUrl(credentials: ICredentialDataDecryptedObject): string {
	let url = String(credentials.baseUrl || 'https://api.2sign.co.il').trim();
	url = url.replace(/\/+$/, '');
	url = url.replace(/\/api$/i, '');
	return url;
}

/** התשובות של חתימה ירוקה מסומנות בתיעוד כ"string". לפעמים זה JSON בתוך מחרוזת. */
export function parseResponse(data: unknown): unknown {
	let value = data;
	for (let i = 0; i < 2; i++) {
		if (typeof value !== 'string') break;
		const text = value.trim();
		if (!text) return {};
		if (!(text.startsWith('{') || text.startsWith('[') || text.startsWith('"')))
			return { message: text };
		try {
			value = JSON.parse(text);
		} catch {
			return { message: text };
		}
	}
	return value;
}

/** חיפוש שדה בלי תלות באותיות גדולות/קטנות, בשכבה הראשונה ובתוך ResponseObject. */
export function findValue(data: unknown, key: string): unknown {
	const wanted = key.toLowerCase();
	const search = (obj: unknown, depth: number): unknown => {
		if (!obj || typeof obj !== 'object' || depth > 2) return undefined;
		if (Array.isArray(obj)) return undefined;
		for (const [k, v] of Object.entries(obj as IDataObject)) {
			if (k.toLowerCase() === wanted && v !== null && v !== undefined && v !== '') return v;
		}
		for (const v of Object.values(obj as IDataObject)) {
			if (v && typeof v === 'object') {
				const found = search(v, depth + 1);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	};
	return search(data, 0);
}

function loginBody(credentials: ICredentialDataDecryptedObject): IDataObject {
	if (credentials.authMethod === 'email') {
		return { Email: credentials.email, Password: credentials.password };
	}
	return {
		GrantType: 'client',
		ClientId: String(credentials.clientId ?? '').trim(),
		ClientSecret: String(credentials.clientSecret ?? '').trim(),
	};
}

/** התחברות: POST /api/Account/LoginApi ← { access_token } */
export async function login(
	ctx: IExecuteFunctions,
	credentials: ICredentialDataDecryptedObject,
	itemIndex?: number,
): Promise<string> {
	let raw: unknown;
	try {
		raw = await ctx.helpers.httpRequest({
			method: 'POST',
			url: `${getBaseUrl(credentials)}/api/Account/LoginApi`,
			body: loginBody(credentials),
			json: true,
		});
	} catch (error) {
		const status = Number(
			(error as { response?: { status?: number } })?.response?.status ??
				(error as { httpCode?: string })?.httpCode,
		);
		let hint = '';
		if ([400, 401, 403].includes(status)) {
			hint = ' כדאי לבדוק שהמזהה והסוד מאותו חשבון, ושהסוד הועתק לפני השמירה.';
		} else if (status === 418) {
			hint =
				' סינון אינטרנט (כמו נטפרי) חוסם את השרת של חתימה ירוקה. צריך לבקש מהסינון לפתוח את api.2sign.co.il.';
		}
		throw new NodeApiError(ctx.getNode(), error as JsonObject, {
			itemIndex,
			message: 'ההתחברות לחתימה ירוקה נכשלה',
			description: `${describeError(error)}.${hint}`,
		});
	}
	// הצלחה: { Status: "success", ResponseObject: { access_token } }
	// כישלון: קוד 200 עם { Status: "failure", Message: "token wasnt created" }
	const data = parseResponse(raw);
	const token = findValue(data, 'access_token');
	if (typeof token !== 'string' || !token) {
		const message =
			data && typeof data === 'object' ? String((data as IDataObject).Message ?? '') : String(data);
		throw new NodeOperationError(
			ctx.getNode(),
			'ההתחברות לחתימה ירוקה נכשלה: המזהה או הסוד לא נכונים',
			{
				itemIndex,
				description: `כדאי לבדוק שהמזהה והסוד מאותו חשבון, ושהסוד הועתק לפני שלחצו Save. אם לא, יוצרים סוד חדש (Generate). התשובה: ${message || JSON.stringify(data)}`,
			},
		);
	}
	return token;
}

export function describeError(error: unknown): string {
	const e = error as {
		message?: string;
		httpCode?: string;
		response?: { status?: number; data?: unknown; body?: unknown };
		cause?: { response?: { status?: number; data?: unknown } };
		description?: string;
	};
	const status = e?.response?.status ?? e?.cause?.response?.status ?? e?.httpCode;
	const body = e?.response?.data ?? e?.response?.body ?? e?.cause?.response?.data ?? e?.description;
	let text = '';
	if (body && typeof body === 'object' && 'ExceptionMessage' in (body as IDataObject)) {
		// שגיאת שרת של חתימה ירוקה: בלי פירוט הקוד הפנימי שלהם
		const b = body as IDataObject;
		text = `תקלה בשרת של חתימה ירוקה: ${String(b.ExceptionMessage)}`;
	} else if (body !== undefined && body !== null && body !== '') {
		text = typeof body === 'string' ? body : JSON.stringify(body);
	}
	const parts: string[] = [];
	if (status) parts.push(`קוד ${status}`);
	if (text) parts.push(text.slice(0, 1000));
	if (!parts.length && e?.message) parts.push(e.message);
	return parts.join(' - ');
}

/**
 * גוף multipart/form-data שנבנה ביד. לא משתמשים ב-FormData וב-Blob,
 * כי הם לא קיימים בכל סביבה ש-n8n רץ בה (נבדק: אין Blob בצעד הקוד של n8n).
 */
export function buildMultipart(
	fields: Record<string, string>,
	fileField: string,
	file: Buffer,
	fileName: string,
	mimeType: string,
): { body: Buffer; contentType: string } {
	const boundary = `----n8n2sign${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'") || 'document.pdf';
	const parts: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
				'utf8',
			),
		);
	}
	parts.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}\r\nContent-Type: ${mimeType}\r\n\r\n`,
			'utf8',
		),
	);
	parts.push(file);
	parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
	return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** מחזיק מפתח גישה אחד לכל הרצה של הנוד. */
export class TwoSignClient {
	private token: string | undefined;

	constructor(
		private readonly ctx: IExecuteFunctions,
		readonly credentials: ICredentialDataDecryptedObject,
	) {}

	get baseUrl(): string {
		return getBaseUrl(this.credentials);
	}

	async request(
		method: IHttpRequestMethods,
		path: string,
		options: {
			qs?: IDataObject;
			body?: IDataObject;
			multipart?: { body: Buffer; contentType: string };
			itemIndex?: number;
			emptyIfNotFound?: boolean;
		} = {},
	): Promise<unknown> {
		for (let attempt = 0; attempt < 2; attempt++) {
			if (!this.token) this.token = await login(this.ctx, this.credentials, options.itemIndex);
			const request: IHttpRequestOptions = {
				method,
				url: `${this.baseUrl}${path}`,
				headers: { Authorization: `Bearer ${this.token}` },
				qs: options.qs,
			};
			if (options.multipart) {
				request.body = options.multipart.body;
				request.headers = { ...request.headers, 'Content-Type': options.multipart.contentType };
			} else {
				if (options.body !== undefined) request.body = options.body;
				request.json = true;
			}
			let raw: unknown;
			try {
				raw = await this.ctx.helpers.httpRequest(request);
			} catch (error) {
				const status =
					(error as { response?: { status?: number } })?.response?.status ??
					Number((error as { httpCode?: string })?.httpCode);
				if (status === 401 && attempt === 0) {
					this.token = undefined;
					continue;
				}
				throw new NodeApiError(this.ctx.getNode(), error as JsonObject, {
					itemIndex: options.itemIndex,
					message: 'חתימה ירוקה החזירה שגיאה',
					description: describeError(error),
				});
			}
			const data = parseResponse(raw);
			return checkStatus(this.ctx, data, options.itemIndex, options.emptyIfNotFound);
		}
		throw new NodeOperationError(this.ctx.getNode(), 'חתימה ירוקה לא אישרה את מפתח הגישה', {
			itemIndex: options.itemIndex,
		});
	}

	/** העלאת קובץ: POST /api/V2/BaseTasks/UploadFileForTask (multipart: Name=fileUpload, FileName=הקובץ) */
	async uploadFile(
		buffer: Buffer,
		fileName: string,
		mimeType: string,
		itemIndex: number,
	): Promise<{ taskGuid: string; pdfGuid: string; response: unknown }> {
		const response = await this.request('POST', '/api/V2/BaseTasks/UploadFileForTask', {
			multipart: buildMultipart({ Name: 'fileUpload' }, 'FileName', buffer, fileName, mimeType),
			itemIndex,
		});
		const pdfGuid = findValue(response, 'PdfGuid');
		const taskGuid = findValue(response, 'TaskGuid');
		if (typeof pdfGuid !== 'string' || !pdfGuid) {
			throw new NodeOperationError(
				this.ctx.getNode(),
				`העלאת הקובץ לא החזירה מזהה קובץ (PdfGuid). התשובה: ${JSON.stringify(response)}`,
				{ itemIndex },
			);
		}
		return {
			pdfGuid,
			taskGuid: typeof taskGuid === 'string' && taskGuid ? taskGuid : pdfGuid,
			response,
		};
	}
}

/** קודים שחתימה ירוקה מחזירה (נבדק מול השרת, 24.11.2026). */
const NOT_FOUND_CODE = 19; // אין תוצאות (חיפוש לקוחות, כל הקבוצות)
const KNOWN_MESSAGES: Record<string, string> = {
	'16': 'הקובץ לא הגיע לחתימה ירוקה',
	NoFileWasSent: 'הקובץ לא הגיע לחתימה ירוקה',
	'19': 'לא נמצאו תוצאות',
	'23': 'המשימה לא נמצאה. כדאי לבדוק את מזהה המשימה (GUID).',
	'151': 'הלקוח לא נמצא, או שהפרטים שלו לא תקינים',
	TaskNotFoundByGuid: 'המשימה לא נמצאה. כדאי לבדוק את מזהה המשימה (GUID).',
	ClientInformationNotValid: 'הלקוח לא נמצא, או שהפרטים שלו לא תקינים',
};

function responseCodes(data: IDataObject): string[] {
	const codes: string[] = [];
	if (data.MessageID) codes.push(String(data.MessageID));
	const inner = data.ResponseObject as IDataObject | null;
	const api = inner && typeof inner === 'object' ? (inner.APIResponse as unknown) : undefined;
	if (Array.isArray(api)) codes.push(...api.map(String));
	return codes;
}

/**
 * תשובה בצורה { Status, Message, MessageDescription, ResponseObject }.
 * Status יכול להיות success, failed או failure, גם כשקוד ה-HTTP הוא 200.
 */
function checkStatus(
	ctx: IExecuteFunctions,
	data: unknown,
	itemIndex?: number,
	emptyIfNotFound = false,
): unknown {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	const obj = data as IDataObject;
	const status = obj.Status ?? obj.status;
	if (typeof status !== 'string') return data;
	if (!['error', 'fail', 'failed', 'failure'].includes(status.trim().toLowerCase())) return data;

	const codes = responseCodes(obj);
	if (emptyIfNotFound && codes.includes(String(NOT_FOUND_CODE))) return { ResponseObject: [] };

	const description = obj.MessageDescription ? String(obj.MessageDescription) : '';
	const known =
		KNOWN_MESSAGES[description] ?? codes.map((c) => KNOWN_MESSAGES[c]).find((m) => m !== undefined);
	const message = known ?? (obj.Message ? String(obj.Message) : '') ?? '';
	throw new NodeOperationError(ctx.getNode(), `חתימה ירוקה: ${message || 'הפעולה נכשלה'}`, {
		itemIndex,
		description: `התשובה: ${JSON.stringify(cleanEmpty({ Status: obj.Status, Message: obj.Message, MessageDescription: obj.MessageDescription, MessageID: obj.MessageID, codes }))}`,
	});
}

/** מוריד שדות ריקים (null, '', []) כדי שהתוצאה תהיה קריאה. */
export function cleanEmpty<T>(value: T): T {
	if (Array.isArray(value)) return value.map((v) => cleanEmpty(v)) as T;
	if (!value || typeof value !== 'object') return value;
	const out: IDataObject = {};
	for (const [k, v] of Object.entries(value as IDataObject)) {
		if (v === null || v === undefined || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = cleanEmpty(v) as IDataObject;
	}
	return out as T;
}

/** התוכן של התשובה: ResponseObject אם יש, אחרת התשובה כולה. */
export function unwrap(data: unknown): unknown {
	if (data && typeof data === 'object' && !Array.isArray(data) && 'ResponseObject' in data) {
		return (data as IDataObject).ResponseObject;
	}
	return data;
}

/** הופך תשובה לרשימת פריטים. רשימה ריקה = אין פריטים. */
export function toItems(data: unknown): IDataObject[] {
	const inner = unwrap(data);
	if (inner === null || inner === undefined) return [];
	if (Array.isArray(inner)) {
		return inner.map((d) =>
			typeof d === 'object' && d ? cleanEmpty(d as IDataObject) : { value: d },
		) as IDataObject[];
	}
	if (typeof inner === 'object') return [cleanEmpty(inner as IDataObject)];
	return [{ value: inner as string }];
}

export function toObject(data: unknown): IDataObject {
	const inner = unwrap(data);
	if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
		return cleanEmpty(inner as IDataObject);
	}
	if (Array.isArray(inner)) return { items: cleanEmpty(inner as IDataObject[]) };
	if (inner === null || inner === undefined) return {};
	return { value: inner as string };
}

/** שדה JSON מהמשתמש: מקבלים טקסט או אובייקט. */
export function parseJsonParam(
	ctx: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): unknown {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(ctx.getNode(), `השדה "${fieldName}" אינו JSON תקין`, {
			itemIndex,
		});
	}
}

/** מזהה סוג קובץ לפי הבתים הראשונים. */
export function detectFile(
	buffer: Buffer,
	baseName: string,
): { fileName: string; mimeType: string } {
	const head = buffer.subarray(0, 8);
	if (head.subarray(0, 4).toString('latin1') === '%PDF')
		return { fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
	if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG')
		return { fileName: `${baseName}.png`, mimeType: 'image/png' };
	if (head[0] === 0xff && head[1] === 0xd8)
		return { fileName: `${baseName}.jpg`, mimeType: 'image/jpeg' };
	if (head[0] === 0x50 && head[1] === 0x4b)
		return { fileName: `${baseName}.zip`, mimeType: 'application/zip' };
	return { fileName: baseName, mimeType: 'application/octet-stream' };
}
