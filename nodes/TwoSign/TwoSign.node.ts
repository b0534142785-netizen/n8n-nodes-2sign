import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IBinaryKeyData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	SIGNING_URL,
	TwoSignClient,
	detectFile,
	findValue,
	parseJsonParam,
	toItems,
	toObject,
} from './GenericFunctions';
import {
	inputTypeOptions,
	sendingFields,
	TASK_OPTION_API,
	taskOptionsCollection,
} from './descriptions';

const guidField = (
	show: Record<string, string[]>,
	displayName = 'מזהה המשימה (GUID)',
	description = 'ה-TaskGuid שחזר ביצירת המשימה, או שהגיע בהודעה האוטומטית אחרי החתימה',
): INodeProperties => ({
	displayName,
	name: 'taskGuid',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'c788c46d-7f64-48d9-94a0-7d0c3ee56301',
	displayOptions: { show },
	description,
});

const binaryInputField = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'שם הקובץ שנכנס לנוד',
	name: 'binaryPropertyName',
	type: 'string',
	required: true,
	default: 'data',
	displayOptions: { show },
	description: 'השם של הקובץ (binary) שמגיע מהנוד הקודם. בדרך כלל data.',
});

const templateField = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'מספר התבנית',
	name: 'templateIds',
	type: 'string',
	required: true,
	default: '',
	placeholder: '4522',
	displayOptions: { show },
	description:
		'המספר של התבנית בחתימה ירוקה. אפשר כמה מספרים עם פסיק ביניהם (4522,4523), והם יתחברו למסמך אחד.',
});

const subjectField = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'נושא המסמך',
	name: 'taskSubject',
	type: 'string',
	required: true,
	default: '',
	displayOptions: { show },
	description: 'הכותרת שהחותם יראה',
});

const DOCUMENT_TYPES: Record<
	string,
	{ path: string; routinePath?: string; prefix: string; fileBase: string }
> = {
	all: { path: '/api/V2/BaseTasks/GetAllAttachmentsLocationBlob', prefix: '', fileBase: '' },
	signed: {
		path: '/api/V2/BaseTasks/GetSignedTaskLocationBlob',
		routinePath: '/api/V2/GroupTasks/GetSignedTaskLocationBlob',
		prefix: 'SignedTask',
		fileBase: 'signed',
	},
	original: {
		path: '/api/V2/BaseTasks/GetOriginalTaskLocationBlob',
		routinePath: '/api/V2/GroupTasks/GetOriginalTaskLocationBlob',
		prefix: 'Original',
		fileBase: 'original',
	},
	idCard: {
		path: '/api/V2/BaseTasks/GetIdAttachmentLocationBlob',
		prefix: 'IdCardAttachment',
		fileBase: 'id-card',
	},
	general: {
		path: '/api/V2/BaseTasks/GetGeneralAttachmentsLocationBlob',
		prefix: 'GeneralAttachments',
		fileBase: 'attachments',
	},
	excel: {
		path: '/api/V2/BaseTasks/GetExcelAttachmentsLocationBlob',
		prefix: 'ExcelAttachments',
		fileBase: 'attachments-summary',
	},
};

/** שמות השדות של כל סוג קובץ בתשובה: [קישור, בתים, Base64]. */
const FILE_FIELDS: Record<string, [string, string, string]> = {
	signed: ['SignedTaskLinkBlob', 'SignedTaskFile', 'SignedTaskBase64File'],
	original: ['OriginalTaskLinkBlob', 'OriginalBlobFile', 'OriginalBase64File'],
	idCard: ['IdCardAttachmentLinkBlob', 'IdCardAttachmentBlobFile', 'IdCardAttachmentBase64File'],
	general: [
		'GeneralAttachmentsLinkBlob',
		'GeneralAttachmentsBlobFile',
		'GeneralAttachmentsBase64File',
	],
	excel: ['ExcelAttachmentsLinkBlob', 'ExcelAttachmentsBlobFile', 'ExcelAttachmentsBase64File'],
};

export class TwoSign implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'חתימה ירוקה',
		name: 'twoSign',
		icon: { light: 'file:twosign.svg', dark: 'file:twosign.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " · " + $parameter["resource"]}}',
		description: 'שליחת מסמכים לחתימה דיגיטלית בחתימה ירוקה (2Sign)',
		defaults: { name: 'חתימה ירוקה' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'twoSignGreenApi', required: true }],
		properties: [
			{
				displayName: 'סוג',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'משימה לחתימה (חותם אחד)', value: 'task' },
					{ name: 'סבב חתימות (כמה חותמים)', value: 'routine' },
					{ name: 'מסמכים וקבצים של משימה', value: 'document' },
					{ name: 'לקוח', value: 'client' },
					{ name: 'קבוצת לקוחות', value: 'group' },
					{ name: 'תבנית', value: 'template' },
					{ name: 'החשבון', value: 'account' },
				],
				default: 'task',
			},

			// ===== משימה =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['task'] } },
				options: [
					{
						name: 'יצירה מתבנית',
						value: 'createFromTemplate',
						description: 'שליחת מסמך שמוגדר כתבנית. נספר במכסת המסמכים, גם בלי שליחה.',
						action: 'יצירת משימה מתבנית',
					},
					{
						name: 'יצירה מקובץ',
						value: 'createFromFile',
						description: 'העלאת קובץ ושליחה שלו לחתימה. נספר במכסת המסמכים, גם בלי שליחה.',
						action: 'יצירת משימה מקובץ',
					},
					{
						name: 'קבלת פרטים',
						value: 'get',
						description: 'המצב והפרטים של משימה',
						action: 'קבלת פרטים של משימה',
					},
					{
						name: 'חיפוש משימות',
						value: 'search',
						action: 'חיפוש משימות',
					},
					{
						name: 'שליחה מחדש',
						value: 'resend',
						description: 'שליחת המשימה שוב לחותם',
						action: 'שליחה מחדש של משימה',
					},
					{
						name: 'קישור לחתימה',
						value: 'signingLink',
						description: 'בונה את הקישור לחתימה, כדי לשלוח אותו בעצמכם (למשל בוואטסאפ)',
						action: 'קבלת קישור לחתימה',
					},
					{
						name: 'מחיקה',
						value: 'delete',
						description: 'מחיקת המשימה עם כל החותמים והקבצים שלה',
						action: 'מחיקת משימה',
					},
				],
				default: 'createFromTemplate',
			},
			templateField({ resource: ['task'], operation: ['createFromTemplate'] }),
			binaryInputField({ resource: ['task'], operation: ['createFromFile'] }),
			subjectField({ resource: ['task'], operation: ['createFromTemplate', 'createFromFile'] }),
			{
				displayName: 'למי לשלוח',
				name: 'recipientType',
				type: 'options',
				options: [
					{
						name: 'לקוח שכבר שמור בחתימה ירוקה',
						value: 'client',
					},
					{
						name: 'נמען חד-פעמי (טלפון או מייל)',
						value: 'contact',
					},
					{
						name: 'קבוצת לקוחות',
						value: 'group',
					},
				],
				default: 'contact',
				displayOptions: {
					show: { resource: ['task'], operation: ['createFromTemplate', 'createFromFile'] },
				},
			},
			{
				displayName: 'מספר הלקוח',
				name: 'clientId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createFromTemplate', 'createFromFile'],
						recipientType: ['client'],
					},
				},
				description:
					'המספר (ClientId) של הלקוח בחתימה ירוקה. אפשר למצוא אותו בפעולה "לקוח ← חיפוש".',
			},
			{
				displayName: 'שם הנמען',
				name: 'clientName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createFromTemplate', 'createFromFile'],
						recipientType: ['contact'],
					},
				},
			},
			{
				displayName: 'טלפון',
				name: 'clientPhones',
				type: 'string',
				default: '',
				placeholder: '0501234567',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createFromTemplate', 'createFromFile'],
						recipientType: ['contact'],
					},
				},
				description: 'צריך טלפון או מייל, לפחות אחד מהם',
			},
			{
				displayName: 'מייל',
				name: 'clientEmails',
				type: 'string',
				default: '',
				placeholder: 'name@example.com',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createFromTemplate', 'createFromFile'],
						recipientType: ['contact'],
					},
				},
				description: 'צריך טלפון או מייל, לפחות אחד מהם',
			},
			{
				displayName: 'מספר הקבוצה',
				name: 'groupId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createFromTemplate', 'createFromFile'],
						recipientType: ['group'],
					},
				},
				description: 'אפשר למצוא אותו בפעולה "קבוצת לקוחות ← כל הקבוצות"',
			},
			...sendingFields({ resource: ['task'], operation: ['createFromTemplate', 'createFromFile'] }),
			taskOptionsCollection({
				resource: ['task'],
				operation: ['createFromTemplate', 'createFromFile'],
			}),
			guidField({ resource: ['task'], operation: ['get', 'resend', 'delete', 'signingLink'] }),
			{
				displayName: 'לשלוח שוב דרך',
				name: 'resendChannels',
				type: 'multiOptions',
				required: true,
				options: [
					{ name: 'מייל', value: 'email' },
					{ name: 'הודעת SMS', value: 'sms' },
					{ name: 'וואטסאפ', value: 'whatsapp' },
				],
				default: ['email'],
				displayOptions: { show: { resource: ['task'], operation: ['resend'] } },
			},
			{
				displayName: 'נושא המייל',
				name: 'emailSubject',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['task'], operation: ['resend'] } },
			},
			{
				displayName: 'סינון',
				name: 'filters',
				type: 'collection',
				placeholder: 'הוספת סינון',
				default: {},
				displayOptions: { show: { resource: ['task'], operation: ['search'] } },
				options: [
					{
						displayName: 'מייל של הנמען',
						name: 'ClientEmails',
						type: 'string',
						default: '',
					},
					{
						displayName: 'מספר הלקוח',
						name: 'ClientId',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'מספר התבנית',
						name: 'TemplateId',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'מצב המשימה (מספר)',
						name: 'FilterTaskStatus',
						type: 'number',
						default: 0,
						description: '20 = נחתם (נבדק מול השרת). שאר המספרים לא מפורטים בתיעוד של חתימה ירוקה.',
					},
					{
						displayName: 'מתאריך',
						name: 'FilterDateFrom',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'נושא המסמך',
						name: 'TaskSubject',
						type: 'string',
						default: '',
					},
					{
						displayName: 'עד תאריך',
						name: 'FilterDateTo',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'טלפון של הנמען',
						name: 'ClientPhones',
						type: 'string',
						default: '',
					},
				],
			},

			// ===== סבב חתימות =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['routine'] } },
				options: [
					{
						name: 'יצירה מתבנית',
						value: 'createFromTemplate',
						action: 'יצירת סבב חתימות מתבנית',
					},
					{
						name: 'יצירה מקובץ',
						value: 'createFromFile',
						action: 'יצירת סבב חתימות מקובץ',
					},
					{
						name: 'קבלת פרטים',
						value: 'get',
						action: 'קבלת פרטים של סבב חתימות',
					},
					{
						name: 'הסרת חותם',
						value: 'deleteSigner',
						description: 'הוצאת חותם אחד מהסבב, בלי לבטל את הסבב לשאר החותמים',
						action: 'הסרת חותם מסבב חתימות',
					},
				],
				default: 'createFromTemplate',
			},
			templateField({ resource: ['routine'], operation: ['createFromTemplate'] }),
			binaryInputField({ resource: ['routine'], operation: ['createFromFile'] }),
			subjectField({ resource: ['routine'], operation: ['createFromTemplate', 'createFromFile'] }),
			{
				displayName: 'סדר החתימה',
				name: 'signingOrder',
				type: 'options',
				options: [
					{
						name: 'אחד אחרי השני',
						value: 'sequential',
						description: 'כל חותם מקבל את המסמך רק אחרי שהקודם חתם',
					},
					{
						name: 'כולם ביחד',
						value: 'parallel',
						description: 'כל החותמים מקבלים את המסמך באותו זמן',
					},
				],
				default: 'sequential',
				displayOptions: {
					show: { resource: ['routine'], operation: ['createFromTemplate', 'createFromFile'] },
				},
			},
			{
				displayName: 'מספר הקבוצה',
				name: 'groupId',
				type: 'number',
				default: 0,
				displayOptions: {
					show: { resource: ['routine'], operation: ['createFromTemplate', 'createFromFile'] },
				},
				description:
					'קבוצת החותמים השמורה בחתימה ירוקה. 0 = בלי קבוצה, והחותמים מוגדרים למטה. בקבוצה, הסדר בקבוצה הוא סדר החתימה.',
			},
			{
				displayName: 'איך מסמנים את מקום החתימה של כל חותם',
				name: 'fieldsMode',
				type: 'options',
				options: [
					{
						name: 'לפי השדות שבתבנית',
						value: 'template',
						description: 'השדות כבר מסומנים בתבנית בחתימה ירוקה',
					},
					{
						name: 'לפי סימנים בתוך המסמך',
						value: 'markers',
						description: 'לכל חותם יש סימן משלו בתוך הקובץ, למשל ### ו-@@@',
					},
					{
						name: 'מיקום מדויק (JSON)',
						value: 'json',
						description: 'רשימת שדות עם מיקום, כמו בתיעוד של חתימה ירוקה',
					},
				],
				default: 'markers',
				displayOptions: {
					show: { resource: ['routine'], operation: ['createFromTemplate', 'createFromFile'] },
				},
			},
			{
				displayName: 'החותמים (לפי הסדר)',
				name: 'signers',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				placeholder: 'הוספת חותם',
				default: {},
				displayOptions: {
					show: {
						resource: ['routine'],
						operation: ['createFromTemplate', 'createFromFile'],
						fieldsMode: ['markers'],
					},
				},
				description: 'הראשון ברשימה חותם ראשון. לכל חותם: לקוח שמור, או שם עם טלפון או מייל.',
				options: [
					{
						displayName: 'חותם',
						name: 'signer',
						values: [
							{
								displayName: 'הסימן שלו בתוך המסמך',
								name: 'marker',
								type: 'string',
								required: true,
								default: '',
								placeholder: '###',
								description: 'סימן נדיר שכתוב בקובץ במקום שבו החותם הזה חותם. לכל חותם סימן אחר.',
							},
							{
								displayName: 'סוג השדה',
								name: 'inputType',
								type: 'options',
								options: inputTypeOptions,
								default: 0,
							},
							{
								displayName: 'מספר לקוח שמור (לא חובה)',
								name: 'clientId',
								type: 'number',
								default: 0,
								description: '0 = לא לקוח שמור. אז צריך שם, וטלפון או מייל.',
							},
							{
								displayName: 'שם',
								name: 'clientName',
								type: 'string',
								default: '',
							},
							{
								displayName: 'טלפון',
								name: 'clientPhones',
								type: 'string',
								default: '',
							},
							{
								displayName: 'מייל',
								name: 'clientEmails',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'השדות (JSON)',
				name: 'routinePositions',
				type: 'json',
				required: true,
				default:
					'[\n  {\n    "X": 20, "Y": 100, "Width": 30, "Height": 20, "Page": 1,\n    "SignaturePositionTypeId": 1, "SignaturePositionStageTypeId": 0, "SignaturePositionFieldType": 0,\n    "ClientId": 0, "Emails": "", "Phones": "",\n    "SignatureRoutineSignerNumber": 1, "IsSignatureRoutine": true\n  }\n]',
				displayOptions: {
					show: {
						resource: ['routine'],
						operation: ['createFromTemplate', 'createFromFile'],
						fieldsMode: ['json'],
					},
				},
				description:
					'כל שדה שייך לחותם: ClientId של לקוח שמור, או Emails / Phones. SignatureRoutineSignerNumber הוא הסדר (1 = ראשון).',
			},
			...sendingFields({
				resource: ['routine'],
				operation: ['createFromTemplate', 'createFromFile'],
			}),
			taskOptionsCollection({
				resource: ['routine'],
				operation: ['createFromTemplate', 'createFromFile'],
			}),
			guidField({ resource: ['routine'], operation: ['get'] }, 'מזהה הסבב (GUID)'),
			guidField(
				{ resource: ['routine'], operation: ['deleteSigner'] },
				'מזהה החותם בסבב (GUID)',
				'ה-GUID של החותם הספציפי בסבב (TaskClient), ולא של הסבב כולו',
			),

			// ===== מסמכים =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'קבלת מסמך',
						value: 'get',
						description: 'המסמך החתום, המקורי, תעודת הזהות או קבצים שהחותם העלה',
						action: 'קבלת מסמך של משימה',
					},
				],
				default: 'get',
			},
			{
				displayName: 'איזה מסמך',
				name: 'documentType',
				type: 'options',
				options: [
					{ name: 'המסמך החתום', value: 'signed' },
					{ name: 'המסמך המקורי (לפני החתימה)', value: 'original' },
					{ name: 'צילום תעודת הזהות', value: 'idCard' },
					{ name: 'קבצים שהחותם העלה (ZIP)', value: 'general' },
					{ name: 'קובץ אקסל שמסכם את הקבצים', value: 'excel' },
					{ name: 'הכול ביחד', value: 'all' },
				],
				default: 'signed',
				displayOptions: { show: { resource: ['document'] } },
			},
			guidField(
				{ resource: ['document'] },
				'מזהה המשימה (GUID)',
				'במשימה רגילה: ה-TaskGuid. בסבב חתימות: ה-GUID של החותם הספציפי (TaskClient).',
			),
			{
				displayName: 'זה סבב חתימות',
				name: 'isRoutine',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['document'], documentType: ['signed', 'original'] } },
				description: 'האם המשימה היא סבב חתימות. בסבב, המסמך החתום והמקורי נלקחים ממקום אחר.',
			},
			{
				displayName: 'מה להחזיר',
				name: 'outputMode',
				type: 'options',
				options: [
					{
						name: 'את הקובץ עצמו',
						value: 'file',
						description: 'הקובץ יוצא מהנוד, ואפשר לשמור או לשלוח אותו הלאה',
					},
					{
						name: 'קישור להורדה',
						value: 'link',
						description: 'קישור זמני. צריך להוריד ממנו מהר, כי הוא פג.',
					},
				],
				default: 'file',
				displayOptions: { show: { resource: ['document'] } },
			},
			{
				displayName: 'שם הקובץ שיוצא מהנוד',
				name: 'outputBinaryName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { resource: ['document'], outputMode: ['file'] } },
				description:
					'בבחירה "הכול ביחד" כל קובץ מקבל שם משלו: original, signed, idCard, general, excel',
			},
			{
				displayName: 'אפשרויות נוספות',
				name: 'documentOptions',
				type: 'collection',
				placeholder: 'הוספת אפשרות',
				default: {},
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						displayName: 'מספר המשימה (TaskId)',
						name: 'taskId',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'חלק מהמסמך החתום (סבב בלבד)',
						name: 'segment',
						type: 'number',
						default: 0,
					},
				],
			},

			// ===== לקוח =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['client'] } },
				options: [
					{ name: 'יצירה', value: 'create', action: 'יצירת לקוח' },
					{ name: 'קבלה לפי מספר', value: 'get', action: 'קבלת לקוח לפי מספר' },
					{
						name: 'חיפוש',
						value: 'search',
						description: 'לפי שם, מייל או טלפון',
						action: 'חיפוש לקוחות',
					},
					{
						name: 'מחיקה',
						value: 'delete',
						description: 'לא מומלץ ללקוח שיש לו מסמכים במערכת',
						action: 'מחיקת לקוחות',
					},
				],
				default: 'create',
			},
			{
				displayName: 'שם',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['client'], operation: ['create'] } },
			},
			{
				displayName: 'מייל',
				name: 'emails',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['client'], operation: ['create'] } },
			},
			{
				displayName: 'טלפון',
				name: 'phones',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['client'], operation: ['create'] } },
			},
			{
				displayName: 'מספר עוסק / ח.פ.',
				name: 'compNum',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['client'], operation: ['create'] } },
			},
			{
				displayName: 'מספר הלקוח',
				name: 'clientIdText',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['client'], operation: ['get'] } },
			},
			{
				displayName: 'מספרי הלקוחות',
				name: 'clientIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: '123456,789012',
				displayOptions: { show: { resource: ['client'], operation: ['delete'] } },
				description:
					'אפשר כמה מספרים עם פסיק. לקוח עם משימות פעילות לא יימחק, והוא יופיע בתשובה ברשימת מה שלא נמחק.',
			},
			{
				displayName: 'חיפוש לפי',
				name: 'clientSearch',
				type: 'collection',
				placeholder: 'הוספת שדה לחיפוש',
				default: {},
				displayOptions: { show: { resource: ['client'], operation: ['search'] } },
				options: [
					{ displayName: 'מייל', name: 'Emails', type: 'string', default: '' },
					{ displayName: 'שם', name: 'Name', type: 'string', default: '' },
					{ displayName: 'טלפון', name: 'Phones', type: 'string', default: '' },
				],
			},

			// ===== קבוצה =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['group'] } },
				options: [
					{ name: 'יצירה', value: 'create', action: 'יצירת קבוצה' },
					{
						name: 'הוספת לקוחות לקבוצה',
						value: 'addClients',
						action: 'הוספת לקוחות לקבוצה',
					},
					{
						name: 'קבלה לפי מספר',
						value: 'get',
						description: 'כולל רשימת הלקוחות בקבוצה',
						action: 'קבלת קבוצה לפי מספר',
					},
					{ name: 'כל הקבוצות', value: 'getAll', action: 'קבלת כל הקבוצות' },
				],
				default: 'create',
			},
			{
				displayName: 'שם הקבוצה',
				name: 'groupName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['group'], operation: ['create'] } },
			},
			{
				displayName: 'מספר הקבוצה',
				name: 'groupIdValue',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['group'], operation: ['addClients', 'get'] } },
			},
			{
				displayName: 'מספרי הלקוחות',
				name: 'groupClientIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: '201482,201483',
				displayOptions: { show: { resource: ['group'], operation: ['addClients'] } },
				description: 'אפשר כמה מספרים עם פסיק ביניהם',
			},

			// ===== תבנית =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['template'] } },
				options: [
					{
						name: 'קבלה לפי מספר',
						value: 'get',
						description: 'כולל מיקומי השדות (SignaturePositions)',
						action: 'קבלת תבנית לפי מספר',
					},
					{
						name: 'חיפוש',
						value: 'search',
						description: 'לפי מספר, מספר פנימי או שם',
						action: 'חיפוש תבניות',
					},
				],
				default: 'get',
			},
			{
				displayName: 'מספר התבנית',
				name: 'templateId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['template'], operation: ['get'] } },
			},
			{
				displayName: 'חיפוש לפי',
				name: 'templateSearch',
				type: 'collection',
				placeholder: 'הוספת שדה לחיפוש',
				default: {},
				displayOptions: { show: { resource: ['template'], operation: ['search'] } },
				options: [
					{ displayName: 'מספר התבנית', name: 'templateId', type: 'number', default: 0 },
					{ displayName: 'מספר פנימי', name: 'templateNumber', type: 'string', default: '' },
					{ displayName: 'שם התבנית', name: 'templateName', type: 'string', default: '' },
				],
			},

			// ===== החשבון =====
			{
				displayName: 'פעולה',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'כמה משימות החודש',
						value: 'taskCount',
						description: 'מספר המשימות שנוצרו החודש',
						action: 'ספירת המשימות החודש',
					},
				],
				default: 'taskCount',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('twoSignGreenApi');
		const client = new TwoSignClient(this, credentials);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const out = (data: unknown) => {
					for (const json of toItems(data)) returnData.push({ json, pairedItem: { item: i } });
				};

				if (resource === 'task' || resource === 'routine') {
					if (operation === 'createFromTemplate' || operation === 'createFromFile') {
						const body = await buildTaskBody.call(this, client, resource, operation, i);
						// בתיעוד יצירה מקובץ היא TasksNew/CreateTask, אבל הכתובת הזאת לא קיימת (404, נבדק 24.11.2026).
						// Tasks/CreateTask מקבלת גם תבנית וגם קובץ שהועלה.
						const path =
							resource === 'routine' ? '/api/v2/GroupTasks/CreateTask' : '/api/V2/Tasks/CreateTask';
						const response = toObject(await client.request('POST', path, { body, itemIndex: i }));
						const guid = findValue(response, 'TaskGuid') ?? body.TaskGuid;
						if (typeof guid === 'string' && guid) {
							response.taskGuid = guid;
							response.signingUrl = SIGNING_URL + guid;
						}
						returnData.push({ json: response, pairedItem: { item: i } });
						continue;
					}

					if (operation === 'search') {
						const filters = cleanObject(this.getNodeParameter('filters', i, {}) as IDataObject);
						// בלי שום סינון השרת של חתימה ירוקה קורס (נבדק). המזהה (Token) מספיק כדי שיעבוד.
						filters.Token = String(credentials.clientId ?? '').trim();
						out(
							await client.request('POST', '/api/Tasks/GetTasksBySearchParams', {
								body: filters,
								itemIndex: i,
								emptyIfNotFound: true,
							}),
						);
						continue;
					}

					const guid = (this.getNodeParameter('taskGuid', i) as string).trim();
					if (operation === 'signingLink') {
						returnData.push({
							json: { taskGuid: guid, signingUrl: SIGNING_URL + guid },
							pairedItem: { item: i },
						});
					} else if (operation === 'get') {
						const path =
							resource === 'routine'
								? '/api/GroupTasks/GetTaskByGuid'
								: '/api/V2/BaseTasks/GetTaskByGuid';
						out(await client.request('GET', path, { qs: { guid }, itemIndex: i }));
					} else if (operation === 'resend') {
						const channels = this.getNodeParameter('resendChannels', i) as string[];
						const emailSubject = this.getNodeParameter('emailSubject', i, '') as string;
						const qs: IDataObject = {
							taskGuid: guid,
							resendPhone: channels.includes('sms'),
							resendEmail: channels.includes('email'),
							resendWhatsapp: channels.includes('whatsapp'),
						};
						if (emailSubject) qs.emailSubject = emailSubject;
						out(await client.request('GET', '/api/V2/Tasks/ResendTask', { qs, itemIndex: i }));
					} else if (operation === 'delete') {
						out(
							await client.request('POST', '/api/V2/BaseTasks/DeleteTaskByGuid', {
								qs: { guid },
								itemIndex: i,
							}),
						);
					} else if (operation === 'deleteSigner') {
						out(
							await client.request('POST', '/api/V2/BaseTasks/DeleteTaskClientByGuid', {
								qs: { guid },
								itemIndex: i,
							}),
						);
					}
				} else if (resource === 'document') {
					await getDocument.call(this, client, i, returnData);
				} else if (resource === 'client') {
					if (operation === 'create') {
						const body: IDataObject = { Name: this.getNodeParameter('name', i) };
						for (const [param, api] of [
							['emails', 'Emails'],
							['phones', 'Phones'],
							['compNum', 'CompNum'],
						]) {
							const v = this.getNodeParameter(param, i, '') as string;
							if (v) body[api] = v;
						}
						out(await client.request('POST', '/api/Clients/Create', { body, itemIndex: i }));
					} else if (operation === 'get') {
						const clientId = String(this.getNodeParameter('clientIdText', i)).trim();
						out(
							await client.request('GET', '/api/Clients/GetById', {
								qs: { clientId },
								itemIndex: i,
							}),
						);
					} else if (operation === 'search') {
						const body = cleanObject(this.getNodeParameter('clientSearch', i, {}) as IDataObject);
						if (!Object.keys(body).length) {
							// בלי שדה לחיפוש השרת של חתימה ירוקה קורס (נבדק)
							throw new NodeOperationError(
								this.getNode(),
								'צריך למלא לפחות שדה אחד לחיפוש: שם, מייל או טלפון',
								{ itemIndex: i },
							);
						}
						out(
							await client.request('POST', '/api/Clients/GetByParams', {
								body,
								itemIndex: i,
								emptyIfNotFound: true,
							}),
						);
					} else if (operation === 'delete') {
						const ids = parseIds(this.getNodeParameter('clientIds', i) as string);
						if (!ids.length) {
							throw new NodeOperationError(this.getNode(), 'צריך לפחות מספר לקוח אחד', {
								itemIndex: i,
							});
						}
						out(
							await client.request('POST', '/api/Clients/Delete', {
								body: { Clients: ids.map((ClientId) => ({ ClientId })) },
								itemIndex: i,
							}),
						);
					}
				} else if (resource === 'group') {
					if (operation === 'create') {
						out(
							await client.request('POST', '/api/Groups/Create', {
								body: { Name: this.getNodeParameter('groupName', i) },
								itemIndex: i,
							}),
						);
					} else if (operation === 'addClients') {
						const groupId = this.getNodeParameter('groupIdValue', i) as number;
						const ids = parseIds(this.getNodeParameter('groupClientIds', i) as string);
						if (!ids.length) {
							throw new NodeOperationError(this.getNode(), 'צריך לפחות מספר לקוח אחד', {
								itemIndex: i,
							});
						}
						out(
							await client.request('POST', '/api/Groups/AssignClientsToGroup', {
								body: {
									Id: groupId,
									GroupClients: ids.map((ClientId) => ({ GroupId: groupId, ClientId })),
								},
								itemIndex: i,
							}),
						);
					} else if (operation === 'get') {
						out(
							await client.request('POST', '/api/Groups/GetById', {
								qs: { groupId: this.getNodeParameter('groupIdValue', i) },
								itemIndex: i,
							}),
						);
					} else if (operation === 'getAll') {
						out(
							await client.request('GET', '/api/Groups/GetAllByUser', {
								itemIndex: i,
								emptyIfNotFound: true,
							}),
						);
					}
				} else if (resource === 'template') {
					const token = String(credentials.clientId ?? '').trim();
					if (!token) {
						throw new NodeOperationError(
							this.getNode(),
							'כדי לקרוא תבניות צריך למלא בחיבור את המזהה (Client ID)',
							{ itemIndex: i },
						);
					}
					if (operation === 'get') {
						const id = this.getNodeParameter('templateId', i) as number;
						out(
							await client.request('GET', '/api/v2/Templates/GetTemplateById', {
								// בתיעוד מופיעים שני שמות: id (בהגדרה) ו-templateid (בדוגמה). שולחים את שניהם.
								qs: { token, id, templateid: id },
								itemIndex: i,
							}),
						);
					} else if (operation === 'search') {
						const qs = cleanObject(this.getNodeParameter('templateSearch', i, {}) as IDataObject);
						qs.token = token;
						out(
							await client.request('GET', '/api/v2/Templates/GetTemplateBySearchParams', {
								qs,
								itemIndex: i,
								emptyIfNotFound: true,
							}),
						);
					}
				} else if (resource === 'account' && operation === 'taskCount') {
					// התשובה היא אובייקט משימה מלא; הספירה נמצאת ב-TasksCount (נבדק)
					const info = toObject(
						await client.request('POST', '/api/V2/BaseTasks/GetTasksCountForMonth', {
							body: {},
							itemIndex: i,
						}),
					);
					const json: IDataObject = { tasksThisMonth: info.TasksCount ?? 0 };
					for (const [api, key] of [
						['TasksQuotaLeft', 'tasksQuotaLeft'],
						['SmsCount', 'smsCount'],
						['SmsQuotaLeft', 'smsQuotaLeft'],
					]) {
						if (info[api] !== undefined) json[key] = info[api];
					}
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// שגיאה שכבר נעטפה חוזרת כמו שהיא (n8n מחזיר את המקורית)
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

function parseIds(text: string): number[] {
	return String(text)
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0);
}

/** מוריד ערכים ריקים (0, '', null) כדי לא לשלוח סינון שהמשתמש לא ביקש. */
function cleanObject(obj: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === '' || v === null || v === undefined || v === 0) continue;
		out[k] = v;
	}
	return out;
}

async function buildTaskBody(
	this: IExecuteFunctions,
	client: TwoSignClient,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const body: IDataObject = {
		TaskSubject: this.getNodeParameter('taskSubject', i) as string,
	};

	// מאיפה המסמך
	if (operation === 'createFromTemplate') {
		const ids = String(this.getNodeParameter('templateIds', i))
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!ids.length) {
			throw new NodeOperationError(this.getNode(), 'צריך מספר תבנית', { itemIndex: i });
		}
		if (ids.length === 1) body.TemplateId = Number(ids[0]);
		else body.TemplateIdsList = ids.join(',');
	} else {
		const binaryName = this.getNodeParameter('binaryPropertyName', i) as string;
		const binary = this.helpers.assertBinaryData(i, binaryName);
		const buffer = await this.helpers.getBinaryDataBuffer(i, binaryName);
		const upload = await client.uploadFile(
			buffer,
			binary.fileName || 'document.pdf',
			binary.mimeType || 'application/pdf',
			i,
		);
		body.TaskGuid = upload.taskGuid;
		body.PdfGuid = upload.pdfGuid;
	}

	// למי
	if (resource === 'task') {
		const recipientType = this.getNodeParameter('recipientType', i) as string;
		if (recipientType === 'client') {
			body.ClientId = this.getNodeParameter('clientId', i) as number;
		} else if (recipientType === 'group') {
			body.GroupId = this.getNodeParameter('groupId', i) as number;
		} else {
			const name = (this.getNodeParameter('clientName', i, '') as string).trim();
			const phones = (this.getNodeParameter('clientPhones', i, '') as string).trim();
			const emails = (this.getNodeParameter('clientEmails', i, '') as string).trim();
			if (!phones && !emails) {
				throw new NodeOperationError(this.getNode(), 'צריך טלפון או מייל של הנמען', {
					itemIndex: i,
				});
			}
			if (name) body.ClientName = name;
			if (phones) body.ClientPhones = phones;
			if (emails) body.ClientEmails = emails;
		}
	} else {
		body.SignatureRoutine = true;
		body.SignatureRoutineAsync = this.getNodeParameter('signingOrder', i) === 'parallel';
		const groupId = this.getNodeParameter('groupId', i, 0) as number;
		if (groupId) body.GroupId = groupId;
		const fieldsMode = this.getNodeParameter('fieldsMode', i) as string;
		if (fieldsMode === 'markers') {
			const signers =
				((this.getNodeParameter('signers', i, {}) as IDataObject).signer as IDataObject[]) ?? [];
			if (!signers.length) {
				throw new NodeOperationError(this.getNode(), 'צריך להוסיף לפחות חותם אחד', {
					itemIndex: i,
				});
			}
			body.SearchWordForSignatureRoutine = signers.map((s, index) => {
				const clientId = Number(s.clientId) || 0;
				const entry: IDataObject = {
					ClientId: clientId || null,
					SearchCharSignature: String(s.marker ?? ''),
					SignaturePositionFieldType: Number(s.inputType ?? 0),
					SignerNumberInRoutine: index + 1,
					ClientPhones: (s.clientPhones as string) || null,
					ClientEmails: (s.clientEmails as string) || null,
				};
				if (!clientId) {
					if (!entry.ClientPhones && !entry.ClientEmails) {
						throw new NodeOperationError(
							this.getNode(),
							`לחותם מספר ${index + 1} חסר מספר לקוח, או טלפון או מייל`,
							{ itemIndex: i },
						);
					}
					entry.ClientName = (s.clientName as string) || '';
				}
				return entry;
			});
		} else if (fieldsMode === 'json') {
			const positions = parseJsonParam(
				this,
				this.getNodeParameter('routinePositions', i),
				'השדות (JSON)',
				i,
			);
			if (!Array.isArray(positions) || !positions.length) {
				throw new NodeOperationError(this.getNode(), 'השדות (JSON) צריכים להיות רשימה', {
					itemIndex: i,
				});
			}
			body.SignaturePositions = positions.map((p) => {
				const field: IDataObject = { IsSignatureRoutine: true, ...(p as IDataObject) };
				if (!field.ClientId) delete field.ClientId;
				return field;
			});
		}
	}

	// שליחה
	const sendOnCreation = this.getNodeParameter('sendOnCreation', i) as boolean;
	body.IsSendOnCreation = sendOnCreation;
	if (sendOnCreation) {
		const channels = this.getNodeParameter('sendChannels', i, []) as string[];
		body.IsSendEmailOnCreation = channels.includes('email');
		body.IsSendSmsOnCreation = channels.includes('sms');
		body.IsSendWhatsAppOnCreation = channels.includes('whatsapp');
	}

	// אפשרויות
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	for (const [name, api] of Object.entries(TASK_OPTION_API)) {
		const v = options[name];
		if (v === undefined || v === '') continue;
		body[api] = v;
	}
	if (options.secretCode) {
		body.SecretCode = options.secretCode;
		body.ForceSecretCode = true;
	}
	const prefill = ((options.prefillFields as IDataObject)?.field as IDataObject[]) ?? [];
	if (prefill.length) {
		body.SignaturePositionsStr = prefill
			.filter((f) => f.value !== undefined && f.value !== '')
			.map((f) => `${f.fieldType}-${String(f.value).replace(/\|/g, ' ')}`)
			.join('|');
	}
	const markers = ((options.markerFields as IDataObject)?.marker as IDataObject[]) ?? [];
	if (markers.length) {
		body.SearchWordForMarkingFieldsJson = JSON.stringify(
			markers
				.filter((m) => m.char)
				.map((m) => ({
					fieldSignaturePositionType: String(m.fieldType),
					fieldSearchChar: String(m.char),
				})),
		);
	}
	const fixed = ((options.fixedSignatures as IDataObject)?.signature as IDataObject[]) ?? [];
	if (fixed.length) {
		body.SignaturesConstValues = fixed.map((f) => `${f.page}-${f.position}`).join('|');
	}
	const positions = parseJsonParam(this, options.signaturePositions, 'מיקום מדויק', i);
	if (positions !== undefined) {
		if (resource === 'routine' && Array.isArray(positions)) {
			body.SignaturePositions = positions.map((p) => ({
				IsSignatureRoutine: true,
				...(p as IDataObject),
			}));
		} else {
			body.SignaturePositions = positions;
		}
	}
	const slim = parseJsonParam(this, options.signaturePositionsSlimModel, 'עדכון שדות של התבנית', i);
	if (slim !== undefined) body.SignaturePositionsSlimModel = slim;
	const extraParams = parseJsonParam(this, options.additionalUserParamsObject, 'מידע שלי', i);
	if (extraParams !== undefined) body.AdditionalUserParamsObject = extraParams;
	const extra = parseJsonParam(this, options.extraBody, 'שדות נוספים לשליחה', i);
	if (extra !== undefined) {
		if (typeof extra !== 'object' || Array.isArray(extra)) {
			throw new NodeOperationError(this.getNode(), 'שדות נוספים לשליחה צריכים להיות אובייקט JSON', {
				itemIndex: i,
			});
		}
		Object.assign(body, extra);
	}

	return body;
}

async function getDocument(
	this: IExecuteFunctions,
	client: TwoSignClient,
	i: number,
	returnData: INodeExecutionData[],
) {
	const documentType = this.getNodeParameter('documentType', i) as string;
	const guid = (this.getNodeParameter('taskGuid', i) as string).trim();
	const outputMode = this.getNodeParameter('outputMode', i) as string;
	const isRoutine =
		['signed', 'original'].includes(documentType) &&
		(this.getNodeParameter('isRoutine', i, false) as boolean);
	const docOptions = this.getNodeParameter('documentOptions', i, {}) as IDataObject;
	const def = DOCUMENT_TYPES[documentType];
	const path = isRoutine && def.routinePath ? def.routinePath : def.path;

	const qs: IDataObject = { guid, fileDownloadType: outputMode === 'file' ? 2 : 0 };
	if (docOptions.taskId) qs.taskId = docOptions.taskId;
	if (docOptions.segment && isRoutine && documentType === 'signed') qs.segment = docOptions.segment;

	const raw = await client.request('GET', path, { qs, itemIndex: i });
	const response: IDataObject =
		raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as IDataObject) : {};
	const inner = toObject(raw);

	const kinds = documentType === 'all' ? Object.keys(FILE_FIELDS) : [documentType];

	if (outputMode === 'link') {
		const json: IDataObject = { ...inner };
		for (const kind of kinds) {
			const [linkField] = FILE_FIELDS[kind];
			let link = inner[linkField];
			if (
				!link &&
				documentType !== 'all' &&
				typeof response.Message === 'string' &&
				response.Message.startsWith('http')
			) {
				link = response.Message;
			}
			json[`${kind}Url`] = link || null;
		}
		returnData.push({ json, pairedItem: { item: i } });
		return;
	}

	const outputName = (this.getNodeParameter('outputBinaryName', i, 'data') as string) || 'data';
	const binary: IBinaryKeyData = {};
	const missing: string[] = [];
	for (const kind of kinds) {
		const [, , base64Field] = FILE_FIELDS[kind];
		const base64 = inner[base64Field];
		if (typeof base64 !== 'string' || !base64) {
			missing.push(kind);
			continue;
		}
		const buffer = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
		let { fileName, mimeType } = detectFile(buffer, DOCUMENT_TYPES[kind].fileBase);
		if (kind === 'excel' && mimeType === 'application/zip') {
			fileName = `${DOCUMENT_TYPES[kind].fileBase}.xlsx`;
			mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		}
		const key = documentType === 'all' ? kind : outputName;
		binary[key] = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);
	}

	// לא מחזירים את ה-Base64 הארוך ב-JSON
	const json: IDataObject = {};
	for (const [k, v] of Object.entries(inner)) {
		if (/Base64File$|BlobFile$|^SignedTaskFile$/.test(k)) continue;
		json[k] = v;
	}
	if (missing.length) json.missingFiles = missing;
	if (documentType !== 'all' && missing.length) {
		json.message = 'הקובץ לא קיים במשימה הזאת (אולי עוד לא נחתם, או שהחותם לא העלה אותו)';
	}
	returnData.push({
		json,
		binary: Object.keys(binary).length ? binary : undefined,
		pairedItem: { item: i },
	});
}
