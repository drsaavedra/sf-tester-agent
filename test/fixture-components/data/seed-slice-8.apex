// Slice 8 sample data: two SFUIC Aura records and one small file on the first (safe to run twice).
// The file's ContentDocument id goes into File_Id__c, which lightning:fileCard reads.
List<SfUiC_Aura__c> recs = [SELECT Id, Name, File_Id__c FROM SfUiC_Aura__c WHERE Name IN ('SFUIC Aura 1', 'SFUIC Aura 2') ORDER BY Name];
if (recs.isEmpty()) {
    recs = new List<SfUiC_Aura__c>{
        new SfUiC_Aura__c(Name = 'SFUIC Aura 1', Stage__c = 'Working', Amount__c = 1234.5, Note__c = 'SFUIC first aura record'),
        new SfUiC_Aura__c(Name = 'SFUIC Aura 2', Stage__c = 'New', Amount__c = 50, Note__c = 'SFUIC second aura record')
    };
    insert recs;
    System.debug('made: 2 SFUIC Aura records');
}
SfUiC_Aura__c first = recs[0];
if (String.isBlank(first.File_Id__c)) {
    ContentVersion cv = new ContentVersion(Title = 'SFUIC Aura File', PathOnClient = 'sfuic-aura.txt',
        VersionData = Blob.valueOf('SFUIC Aura seed file'), FirstPublishLocationId = first.Id);
    insert cv;
    first.File_Id__c = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
    update first;
    System.debug('made: SFUIC Aura File');
} else {
    System.debug('nothing (already seeded)');
}
