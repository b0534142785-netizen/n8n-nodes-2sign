import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// הנוד כתוב בעברית (כלל של בעל הפרויקט).
// הכללים האלה דורשים ניסוח באנגלית, או סדר לפי האלף-בית במקום סדר הגיוני, ולכן הם כבויים.
export default [
	...configWithoutCloudSupport,
	{
		rules: {
			'n8n-nodes-base/node-param-description-boolean-without-whether': 'off',
			'n8n-nodes-base/node-param-option-name-wrong-for-get-many': 'off',
			'n8n-nodes-base/node-param-options-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-fixed-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-class-description-display-name-unsuffixed-trigger-node': 'off',
			'@n8n/community-nodes/trigger-node-conventions': 'off',
			'@n8n/community-nodes/operation-standard-action': 'off',
			// בחתימה ירוקה אין דרך לרשום כתובת דרך ה-API: מדביקים אותה בהגדרות החשבון.
			'@n8n/community-nodes/webhook-lifecycle-complete': 'off',
		},
	},
];
