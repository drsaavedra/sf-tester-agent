'use strict';

// The assignment cases of the fixture and the page each renders as, measured on a scratch org. A profile is a label.
const ADMIN = 'System Administrator';
const USER = 'Standard Platform User';
module.exports = [
  { app: 'SfUi_App', object: 'SfUiTyped__c', profile: ADMIN, recordType: 'Alpha_Type', page: 'SfUi_Typed_AppRtProfile_Page' },
  { app: 'SfUi_App', object: 'SfUiTyped__c', profile: ADMIN, recordType: 'Beta_Type', page: 'SfUi_Typed_App_Page' },
  { app: 'SfUi_Console', object: 'SfUiTyped__c', profile: ADMIN, recordType: 'Alpha_Type', page: 'SfUi_Typed_Org_Page' },
  { app: 'SfUi_Console', object: 'SfUiTyped__c', profile: ADMIN, recordType: 'Beta_Type', page: 'SfUi_Typed_Org_Page' },
  { app: 'SfUi_App', object: 'SfUiTyped__c', profile: USER, recordType: 'Alpha_Type', page: 'SfUi_Typed_App_Page' },
  { app: 'SfUi_App', object: 'SfUiTyped__c', profile: USER, recordType: 'Beta_Type', page: 'SfUi_Typed_AppRtProfile_Page' },
  { app: 'SfUi_App', object: 'SfUiDyn__c', profile: ADMIN, recordType: null, page: 'SfUi_Dyn_Record_Page' },
  { app: 'SfUi_Console', object: 'SfUiDyn__c', profile: ADMIN, recordType: null, page: 'SfUi_Dyn_ConsoleProfile_Page' },
  { app: 'SfUi_App', object: 'SfUiDyn__c', profile: USER, recordType: null, page: 'SfUi_Dyn_Gated_Page' },
];
