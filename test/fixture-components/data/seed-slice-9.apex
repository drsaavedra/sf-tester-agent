// Slice 9 sample data: one SFUIC Pal record for the palette record pages (safe to run twice).
if ([SELECT COUNT() FROM SfUiC_Pal__c WHERE Name = 'SFUIC Pal'] == 0) {
    insert new SfUiC_Pal__c(Name = 'SFUIC Pal');
    System.debug('made: SFUIC Pal');
} else {
    System.debug('exists: SFUIC Pal');
}
if ([SELECT COUNT() FROM SfUiC_Tpl_1__c WHERE Name = 'SFUIC Tpl 1'] == 0) {
    insert new SfUiC_Tpl_1__c(Name = 'SFUIC Tpl 1');
    System.debug('made: SFUIC Tpl 1');
} else {
    System.debug('exists: SFUIC Tpl 1');
}
if ([SELECT COUNT() FROM SfUiC_Tpl_2__c WHERE Name = 'SFUIC Tpl 2'] == 0) {
    insert new SfUiC_Tpl_2__c(Name = 'SFUIC Tpl 2');
    System.debug('made: SFUIC Tpl 2');
} else {
    System.debug('exists: SFUIC Tpl 2');
}
if ([SELECT COUNT() FROM SfUiC_Tpl_3__c WHERE Name = 'SFUIC Tpl 3'] == 0) {
    insert new SfUiC_Tpl_3__c(Name = 'SFUIC Tpl 3');
    System.debug('made: SFUIC Tpl 3');
} else {
    System.debug('exists: SFUIC Tpl 3');
}
if ([SELECT COUNT() FROM SfUiC_Tpl_4__c WHERE Name = 'SFUIC Tpl 4'] == 0) {
    insert new SfUiC_Tpl_4__c(Name = 'SFUIC Tpl 4');
    System.debug('made: SFUIC Tpl 4');
} else {
    System.debug('exists: SFUIC Tpl 4');
}
if ([SELECT COUNT() FROM SfUiC_Tpl_5__c WHERE Name = 'SFUIC Tpl 5'] == 0) {
    insert new SfUiC_Tpl_5__c(Name = 'SFUIC Tpl 5');
    System.debug('made: SFUIC Tpl 5');
} else {
    System.debug('exists: SFUIC Tpl 5');
}
if ([SELECT COUNT() FROM SfUiC_Pal_Rec3__c WHERE Name = 'SFUIC Pal Rec 3'] == 0) {
    insert new SfUiC_Pal_Rec3__c(Name = 'SFUIC Pal Rec 3');
    System.debug('made: SFUIC Pal Rec 3');
} else {
    System.debug('exists: SFUIC Pal Rec 3');
}
