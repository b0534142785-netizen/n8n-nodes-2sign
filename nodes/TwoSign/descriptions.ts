import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

/** סוגי השדות במסמך (מהתיעוד: Defining Signature Fields). */
export const fieldTypeIdOptions: INodePropertyOptions[] = [
	{ name: 'חתימה', value: 1 },
	{ name: 'תאריך החתימה (אוטומטי)', value: 2 },
	{ name: 'תעודת זהות', value: 3 },
	{ name: 'מייל', value: 4 },
	{ name: 'טקסט חופשי', value: 5 },
	{ name: 'שם הלקוח', value: 6 },
	{ name: 'שם פרטי', value: 8 },
	{ name: 'שם משפחה', value: 9 },
	{ name: 'טלפון', value: 10 },
	{ name: 'נייד', value: 11 },
	{ name: 'שם מלא', value: 12 },
	{ name: 'כתובת מלאה', value: 13 },
	{ name: 'עיר', value: 14 },
	{ name: 'שם העסק', value: 18 },
	{ name: 'סוג עיסוק', value: 19 },
	{ name: 'ספק', value: 20 },
	{ name: 'תפקיד', value: 21 },
	{ name: 'מספר סידורי', value: 22 },
	{ name: 'מזהה ייחודי', value: 25 },
	{ name: 'שנת לידה', value: 52 },
	{ name: 'כתובת מייל', value: 55 },
];

/** סוג הקלט של שדה (SignaturePositionFieldType). */
export const inputTypeOptions: INodePropertyOptions[] = [
	{ name: 'חתימה', value: 0 },
	{ name: 'טקסט', value: 1 },
	{ name: 'תיבת סימון', value: 2 },
	{ name: 'רשימה נפתחת', value: 3 },
	{ name: 'תאריך', value: 4 },
];

const pagePositionOptions: INodePropertyOptions[] = [
	{ name: 'למעלה מימין', value: 3 },
	{ name: 'למעלה באמצע', value: 2 },
	{ name: 'למעלה משמאל', value: 1 },
	{ name: 'באמצע מימין', value: 6 },
	{ name: 'באמצע העמוד', value: 5 },
	{ name: 'באמצע משמאל', value: 4 },
	{ name: 'למטה מימין', value: 9 },
	{ name: 'למטה באמצע', value: 8 },
	{ name: 'למטה משמאל', value: 7 },
];

/** השם של כל אפשרות בחתימה ירוקה. */
export const TASK_OPTION_API: Record<string, string> = {
	emailSubject: 'EmailSubject',
	emailText: 'EmailText',
	language: 'Language',
	languageMarked: 'LanguageMarked',
	freeTextInput: 'FreeTextInput',
	applyStamp: 'ApplyStamp',
	applyOtp: 'ApplyOTP',
	forceIdUpload: 'ForceIdUpload',
	isIdCardUploadOptional: 'IsIdCardUploadOptional',
	forceIdIssueDateUpload: 'ForceIdIssueDateUpload',
	forceVideoUpload: 'ForceVideoUpload',
	videoUploadText: 'VideoUploadText',
	applyExtraFilesUpload: 'ApplyExtraFilesUpload',
	searchWordForMarkingSignature: 'SearchWordForMarkingSignature',
};

/**
 * אפשרויות שנשלחות כמו שהן ליצירת משימה.
 * api = שם השדה בחתימה ירוקה.
 */
export const simpleTaskOptions: INodeProperties[] = [
	{
		displayName: 'נושא המייל',
		name: 'emailSubject',
		type: 'string',
		default: '',
	},
	{
		displayName: 'תוכן המייל',
		name: 'emailText',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'הטקסט שיופיע במייל לחותם',
	},
	{
		displayName: 'שפת החתימה (מספר)',
		name: 'language',
		type: 'number',
		default: 1,
		description: '1 = עברית. מספרים אחרים לא מפורטים בתיעוד של חתימה ירוקה.',
	},
	{
		displayName: 'קוד השפה',
		name: 'languageMarked',
		type: 'string',
		default: '',
		placeholder: 'he',
		description: 'למשל he לעברית',
	},
	{
		displayName: 'טקסט חופשי למשימה',
		name: 'freeTextInput',
		type: 'string',
		default: '',
	},
	{
		displayName: 'להוסיף את החותמת של החשבון',
		name: 'applyStamp',
		type: 'boolean',
		default: false,
	},
	{
		displayName: 'אבטחה: קוד חד-פעמי לטלפון',
		name: 'applyOtp',
		type: 'boolean',
		default: false,
		description: 'האם החותם יקבל קוד לטלפון לפני שיוכל לפתוח את המסמך',
	},
	{
		displayName: 'אבטחה: לחייב צילום תעודת זהות',
		name: 'forceIdUpload',
		type: 'boolean',
		default: false,
		description: 'האם החותם יעלה צילום של תעודת הזהות אחרי החתימה',
	},
	{
		displayName: 'אבטחה: צילום תעודת זהות לא חובה',
		name: 'isIdCardUploadOptional',
		type: 'boolean',
		default: false,
		description: 'האם להציע לחותם להעלות תעודת זהות, בלי לחייב',
	},
	{
		displayName: 'אבטחה: לחייב תאריך הנפקה של תעודת הזהות',
		name: 'forceIdIssueDateUpload',
		type: 'boolean',
		default: false,
	},
	{
		displayName: 'אבטחה: לחייב סרטון',
		name: 'forceVideoUpload',
		type: 'boolean',
		default: false,
		description: 'האם החותם יצלם או יעלה סרטון',
	},
	{
		displayName: 'אבטחה: ההוראה לסרטון',
		name: 'videoUploadText',
		type: 'string',
		default: '',
		description: 'הטקסט שהחותם יראה כשמבקשים ממנו סרטון',
	},
	{
		displayName: 'לבקש מסמכים נוספים מהחותם',
		name: 'applyExtraFilesUpload',
		type: 'boolean',
		default: false,
		description: 'האם החותם יעלה מסמכים נוספים אחרי החתימה',
	},
	{
		displayName: 'שדות: סימן לחתימה בתוך המסמך',
		name: 'searchWordForMarkingSignature',
		type: 'string',
		default: '',
		placeholder: '§',
		description:
			'תו נדיר שכתוב בתוך הקובץ. בכל מקום שהוא מופיע יתווסף שדה חתימה. לא להשתמש בתווים נפוצים כמו @ או !.',
	},
];

/** אפשרויות שצריך לבנות (רשימות, JSON, קוד סודי). */
const builtTaskOptions: INodeProperties[] = [
	{
		displayName: 'אבטחה: קוד סודי',
		name: 'secretCode',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		description:
			'קוד שהחותם צריך להקליד לפני הפתיחה. מוסרים לו אותו בדרך אחרת (טלפון, פנים אל פנים).',
	},
	{
		displayName: 'שדות: מילוי מראש',
		name: 'prefillFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'הוספת שדה למילוי',
		default: {},
		description: 'ממלא ערכים בשדות שכבר קיימים במסמך (למשל בתבנית)',
		options: [
			{
				displayName: 'שדה',
				name: 'field',
				values: [
					{
						displayName: 'סוג השדה',
						name: 'fieldType',
						type: 'options',
						options: fieldTypeIdOptions,
						default: 12,
					},
					{
						displayName: 'הערך',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'שדות: סימנים בתוך המסמך',
		name: 'markerFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'הוספת סימן',
		default: {},
		description: 'כל סימן שכתוב בתוך הקובץ הופך לשדה מהסוג שבוחרים. כדאי תווים נדירים כמו § ¤ ¬.',
		options: [
			{
				displayName: 'סימן',
				name: 'marker',
				values: [
					{
						displayName: 'הסימן',
						name: 'char',
						type: 'string',
						default: '',
						placeholder: '§',
					},
					{
						displayName: 'סוג השדה',
						name: 'fieldType',
						type: 'options',
						options: fieldTypeIdOptions,
						default: 1,
					},
				],
			},
		],
	},
	{
		displayName: 'שדות: חתימה במקום קבוע בעמוד',
		name: 'fixedSignatures',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'הוספת חתימה',
		default: {},
		options: [
			{
				displayName: 'חתימה',
				name: 'signature',
				values: [
					{
						displayName: 'מספר העמוד',
						name: 'page',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 1,
					},
					{
						displayName: 'המקום בעמוד',
						name: 'position',
						type: 'options',
						options: pagePositionOptions,
						default: 9,
					},
				],
			},
		],
	},
	{
		displayName: 'שדות: מיקום מדויק (JSON)',
		name: 'signaturePositions',
		type: 'json',
		default: '',
		description:
			'רשימת שדות עם X, Y, Width, Height, Page ועוד, כמו בתיעוד של חתימה ירוקה (SignaturePositions). אפשר להעתיק מתבנית.',
	},
	{
		displayName: 'שדות: עדכון שדות של התבנית (JSON)',
		name: 'signaturePositionsSlimModel',
		type: 'json',
		default: '',
		description:
			'רק ביצירה מתבנית. רשימה עם SignaturePositionTypeId, PositionTextContent, Required ועוד (SignaturePositionsSlimModel).',
	},
	{
		displayName: 'מידע שלי שיחזור בהודעה אחרי החתימה (JSON)',
		name: 'additionalUserParamsObject',
		type: 'json',
		default: '',
		description:
			'למשל מספר לקוח אצלכם. חתימה ירוקה מחזירה אותו בהודעה האוטומטית אחרי החתימה (AdditionalUserParamsObject).',
	},
	{
		displayName: 'שדות נוספים לשליחה (JSON)',
		name: 'extraBody',
		type: 'json',
		default: '',
		description:
			'לשדות מהתיעוד של חתימה ירוקה שאין להם מקום כאן. מה שכתוב כאן נוסף לבקשה כמו שהוא, ויכול להחליף ערכים אחרים.',
	},
];

export function taskOptionsCollection(show: Record<string, string[]>): INodeProperties {
	const options = [...simpleTaskOptions, ...builtTaskOptions].sort((a, b) =>
		a.displayName.localeCompare(b.displayName, 'he'),
	);
	return {
		displayName: 'אפשרויות נוספות',
		name: 'options',
		type: 'collection',
		placeholder: 'הוספת אפשרות',
		default: {},
		displayOptions: { show },
		options,
	};
}

export function sendingFields(show: Record<string, string[]>): INodeProperties[] {
	return [
		{
			displayName: 'לשלוח לחותם מיד',
			name: 'sendOnCreation',
			type: 'boolean',
			default: true,
			displayOptions: { show },
			description:
				'האם חתימה ירוקה תשלח את המסמך מיד. אם לא, המשימה נוצרת, ואפשר לשלוח את הקישור לחתימה בעצמכם.',
		},
		{
			displayName: 'לשלוח דרך',
			name: 'sendChannels',
			type: 'multiOptions',
			options: [
				{ name: 'מייל', value: 'email' },
				{ name: 'הודעת SMS', value: 'sms' },
				{ name: 'וואטסאפ', value: 'whatsapp' },
			],
			default: ['email'],
			displayOptions: { show: { ...show, sendOnCreation: [true] } },
		},
	];
}
