import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class TwoSignGreenApi implements ICredentialType {
	name = 'twoSignGreenApi';

	displayName = 'חתימה ירוקה (2Sign) API';

	icon = 'file:../nodes/TwoSign/twosign.svg' as const;

	documentationUrl =
		'https://2sign-co-il.gitbook.io/2sign.co.il-docs/getting-started/authentication';

	properties: INodeProperties[] = [
		{
			displayName:
				'לפני הכול צריך לבקש גישה ל-API מחתימה ירוקה: תמיכה ← API access (https://app.2sign.co.il/en/Support/ApiTicketSubmit). אחרי האישור, המזהה והסוד נמצאים בהגדרות ← API.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'דרך ההתחברות',
			name: 'authMethod',
			type: 'options',
			options: [
				{
					name: 'מזהה וסוד (מומלץ)',
					value: 'client',
					description: 'Client ID ו-Client Secret מההגדרות ← API',
				},
				{
					name: 'מייל וסיסמה (לבדיקות)',
					value: 'email',
					description: 'המייל והסיסמה של החשבון בחתימה ירוקה',
				},
			],
			default: 'client',
		},
		{
			displayName: 'מזהה (Client ID)',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description:
				'נמצא בחתימה ירוקה: הגדרות ← API ← Client ID. צריך אותו גם בהתחברות במייל, כדי לקרוא תבניות.',
		},
		{
			displayName: 'סוד (Client Secret)',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['client'] } },
			description:
				'בהגדרות ← API לוחצים Generate ליד Client Secret, מעתיקים מיד, ורק אז לוחצים Save. אחרי השמירה אי אפשר לראות אותו שוב.',
		},
		{
			displayName: 'מייל',
			name: 'email',
			type: 'string',
			placeholder: 'name@example.com',
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['email'] } },
		},
		{
			displayName: 'סיסמה',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['email'] } },
		},
		{
			displayName: 'כתובת השרת',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.2sign.co.il',
			description: 'לא לשנות, אלא אם חתימה ירוקה ביקשו',
		},
	];

	// בדיקת החיבור: ניסיון התחברות (POST /api/Account/LoginApi)
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ ($credentials.baseUrl || "https://api.2sign.co.il").replace(/\\/+$/, "").replace(/\\/api$/i, "") }}',
			url: '/api/Account/LoginApi',
			method: 'POST',
			body: '={{ $credentials.authMethod === "email" ? { "Email": $credentials.email, "Password": $credentials.password } : { "GrantType": "client", "ClientId": String($credentials.clientId).trim(), "ClientSecret": String($credentials.clientSecret).trim() } }}',
			json: true,
		},
		// סוד שגוי מחזיר קוד 200 עם Status: "failure" (נבדק), ולכן בודקים את התוכן
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'Status',
					value: 'failure',
					message:
						'המזהה או הסוד לא נכונים. כדאי לבדוק שהסוד הועתק לפני שלחצו Save, ואם לא, ליצור סוד חדש (Generate).',
				},
			},
		],
	};
}
