// Slice 4 sample data: creates each SFUIC record only when it is missing, so it is safe to run twice.
// Needs seed-slice-2.apex first (it creates SFUIC Hub 1).
if ([SELECT COUNT() FROM SfUiC_Place__c WHERE Name = 'SFUIC Place 1'] == 0) {
    insert new SfUiC_Place__c(Name = 'SFUIC Place 1', Site__Street__s = '1 SFUIC Street', Site__City__s = 'San Francisco',
        Site__PostalCode__s = '94105');
}

// Enhanced note on SFUIC Hub 1 for the Notes related list.
SfUiC_Hub__c hub = [SELECT Id FROM SfUiC_Hub__c WHERE Name = 'SFUIC Hub 1' LIMIT 1];
if ([SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :hub.Id AND ContentDocument.Title = 'SFUIC Hub Note'] == 0) {
    ContentNote note = new ContentNote(Title = 'SFUIC Hub Note', Content = Blob.valueOf('SFUIC enhanced note body'));
    insert note;
    insert new ContentDocumentLink(ContentDocumentId = note.Id, LinkedEntityId = hub.Id, ShareType = 'V');
}
