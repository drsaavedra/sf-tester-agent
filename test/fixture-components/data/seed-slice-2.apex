// Slice 2 sample data: creates each SFUIC record only when it is missing, so it is safe to run twice.
// Needs seed-slice-1.apex first (it creates SFUIC Account).
Account acct = [SELECT Id FROM Account WHERE Name = 'SFUIC Account' LIMIT 1];

// Theme 1: field types. Field 2 holds the email the duplicate rule matches on.
Map<String, SfUiC_Field__c> fieldsByName = new Map<String, SfUiC_Field__c>();
for (SfUiC_Field__c f : [SELECT Id, Name FROM SfUiC_Field__c WHERE Name LIKE 'SFUIC Field %']) {
    fieldsByName.put(f.Name, f);
}
List<SfUiC_Field__c> newFields = new List<SfUiC_Field__c>();
if (!fieldsByName.containsKey('SFUIC Field 1')) {
    newFields.add(new SfUiC_Field__c(Name = 'SFUIC Field 1', Email__c = 'field1@sfuic.example', Phone__c = '415-555-0101',
        Web__c = 'https://example.com', Memo__c = 'SFUIC memo', Long__c = 'SFUIC long text', Rich__c = '<b>SFUIC rich</b>',
        Secret__c = 'SFUIC-SECRET-1234', Locked__c = 'SFUIC locked value', Stage__c = 'Draft', Tone__c = 'Calm',
        Flagged__c = true, Reason__c = 'Late', Account__c = acct.Id));
}
if (!fieldsByName.containsKey('SFUIC Field 2')) {
    newFields.add(new SfUiC_Field__c(Name = 'SFUIC Field 2', Email__c = 'dupe@sfuic.example', Stage__c = 'Review'));
}
insert newFields;
for (SfUiC_Field__c f : newFields) {
    fieldsByName.put(f.Name, f);
}
SfUiC_Field__c field1 = fieldsByName.get('SFUIC Field 1');
if ([SELECT COUNT() FROM SfUiC_Line__c WHERE Field__c = :field1.Id] == 0) {
    insert new List<SfUiC_Line__c>{
        new SfUiC_Line__c(Name = 'SFUIC Line 1', Field__c = field1.Id, Qty__c = 2),
        new SfUiC_Line__c(Name = 'SFUIC Line 2', Field__c = field1.Id, Qty__c = 3)
    };
}
// A tracked change, so the history related list has a row.
if ([SELECT Stage__c FROM SfUiC_Field__c WHERE Id = :field1.Id].Stage__c == 'Draft') {
    update new SfUiC_Field__c(Id = field1.Id, Stage__c = 'Review');
}

// Themes 3, 4 and 6: one hub with eight items (more than the six-row card), a task and an event,
// plus 60 bulk items across both record types for the list views and Kanban.
List<SfUiC_Hub__c> hubs = [SELECT Id FROM SfUiC_Hub__c WHERE Name = 'SFUIC Hub 1' LIMIT 1];
SfUiC_Hub__c hub;
if (hubs.isEmpty()) {
    hub = new SfUiC_Hub__c(Name = 'SFUIC Hub 1', Account__c = acct.Id);
    insert hub;
} else {
    hub = hubs[0];
}
Id alphaRt = Schema.SObjectType.SfUiC_Item__c.getRecordTypeInfosByDeveloperName().get('SfUiC_Alpha').getRecordTypeId();
Id betaRt = Schema.SObjectType.SfUiC_Item__c.getRecordTypeInfosByDeveloperName().get('SfUiC_Beta').getRecordTypeId();
List<String> kinds = new List<String>{ 'Todo', 'Doing', 'Done' };
if ([SELECT COUNT() FROM SfUiC_Item__c WHERE Hub__c = :hub.Id] == 0) {
    List<SfUiC_Item__c> items = new List<SfUiC_Item__c>();
    for (Integer i = 1; i <= 8; i++) {
        items.add(new SfUiC_Item__c(Name = 'SFUIC Item ' + i, Hub__c = hub.Id, Kind__c = kinds[Math.mod(i, 3)],
            Score__c = i * 10, RecordTypeId = Math.mod(i, 2) == 0 ? alphaRt : betaRt));
    }
    insert items;
}
if ([SELECT COUNT() FROM SfUiC_Item__c WHERE Name LIKE 'SFUIC Bulk %'] == 0) {
    List<SfUiC_Item__c> bulkItems = new List<SfUiC_Item__c>();
    for (Integer i = 1; i <= 60; i++) {
        bulkItems.add(new SfUiC_Item__c(Name = 'SFUIC Bulk ' + String.valueOf(i).leftPad(2, '0'), Kind__c = kinds[Math.mod(i, 3)],
            Score__c = i, RecordTypeId = Math.mod(i, 2) == 0 ? alphaRt : betaRt));
    }
    insert bulkItems;
}
if ([SELECT COUNT() FROM Task WHERE WhatId = :hub.Id] == 0) {
    insert new List<Task>{
        new Task(Subject = 'SFUIC Overdue Task', WhatId = hub.Id, ActivityDate = Date.today().addDays(-3), Status = 'Not Started'),
        new Task(Subject = 'SFUIC Upcoming Task', WhatId = hub.Id, ActivityDate = Date.today().addDays(3), Status = 'Not Started'),
        new Task(Subject = 'SFUIC Done Task', WhatId = hub.Id, ActivityDate = Date.today().addDays(-10), Status = 'Completed')
    };
    insert new Event(Subject = 'SFUIC Event', WhatId = hub.Id, StartDateTime = System.now().addDays(1), EndDateTime = System.now().addDays(1).addHours(1));
}

// Theme 7: an open Opportunity for the Path Select Closed Stage dialog (admin only).
if ([SELECT COUNT() FROM Opportunity WHERE Name = 'SFUIC Opp'] == 0) {
    insert new Opportunity(Name = 'SFUIC Opp', AccountId = acct.Id, StageName = 'Prospecting', CloseDate = Date.today().addDays(30));
}

// Theme 2: one record per template object, so each template page has a record to open.
if ([SELECT COUNT() FROM SfUiC_T01__c WHERE Name = 'SFUIC T01'] == 0) { insert new SfUiC_T01__c(Name = 'SFUIC T01'); }
if ([SELECT COUNT() FROM SfUiC_T02__c WHERE Name = 'SFUIC T02'] == 0) { insert new SfUiC_T02__c(Name = 'SFUIC T02'); }
if ([SELECT COUNT() FROM SfUiC_T03__c WHERE Name = 'SFUIC T03'] == 0) { insert new SfUiC_T03__c(Name = 'SFUIC T03'); }
if ([SELECT COUNT() FROM SfUiC_T04__c WHERE Name = 'SFUIC T04'] == 0) { insert new SfUiC_T04__c(Name = 'SFUIC T04'); }
if ([SELECT COUNT() FROM SfUiC_T05__c WHERE Name = 'SFUIC T05'] == 0) { insert new SfUiC_T05__c(Name = 'SFUIC T05'); }
if ([SELECT COUNT() FROM SfUiC_T06__c WHERE Name = 'SFUIC T06'] == 0) { insert new SfUiC_T06__c(Name = 'SFUIC T06'); }
