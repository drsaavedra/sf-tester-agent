// Slice 1 sample data: creates each SFUIC record only when it is missing, so it is safe to run twice.
Account acct;
List<Account> accts = [SELECT Id FROM Account WHERE Name = 'SFUIC Account' LIMIT 1];
if (accts.isEmpty()) {
    acct = new Account(Name = 'SFUIC Account', BillingStreet = '1 Market St', BillingCity = 'San Francisco',
        BillingState = 'CA', BillingPostalCode = '94105', BillingCountry = 'USA');
    insert acct;
} else {
    acct = accts[0];
}

if ([SELECT COUNT() FROM Contact WHERE LastName = 'SFUIC Contact'] == 0) {
    insert new Contact(FirstName = 'Sam', LastName = 'SFUIC Contact', AccountId = acct.Id, Email = 'sfuic@example.com',
        MailingStreet = '2 Market St', MailingCity = 'San Francisco', MailingPostalCode = '94105', MailingCountry = 'USA');
}

if ([SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :acct.Id] == 0) {
    ContentVersion cv = new ContentVersion(Title = 'SFUIC File', PathOnClient = 'sfuic-file.txt',
        VersionData = Blob.valueOf('SFUIC file body'), FirstPublishLocationId = acct.Id);
    insert cv;
}

if ([SELECT COUNT() FROM Note WHERE ParentId = :acct.Id AND Title = 'SFUIC Note'] == 0) {
    insert new Note(ParentId = acct.Id, Title = 'SFUIC Note', Body = 'SFUIC note body');
}

Set<String> have = new Set<String>();
for (SfUiC_Shape__c s : [SELECT Name FROM SfUiC_Shape__c WHERE Name LIKE 'SFUIC Shape %']) {
    have.add(s.Name);
}
List<SfUiC_Shape__c> shapes = new List<SfUiC_Shape__c>();
for (Integer i = 1; i <= 3; i++) {
    String name = 'SFUIC Shape ' + i;
    if (!have.contains(name)) {
        shapes.add(new SfUiC_Shape__c(Name = name, Account__c = acct.Id, Amount__c = 100 * i, Rate__c = 5 * i,
            Spot__Latitude__s = 37.79, Spot__Longitude__s = -122.39, Active__c = Math.mod(i, 2) == 1,
            Status__c = 'New', Size__c = i));
    }
}
insert shapes;

SfUiC_Shape__c first = [SELECT Id FROM SfUiC_Shape__c WHERE Name = 'SFUIC Shape 1' LIMIT 1];
if ([SELECT COUNT() FROM SfUiC_Part__c WHERE Shape__c = :first.Id] == 0) {
    insert new SfUiC_Part__c(Name = 'SFUIC Part 1', Shape__c = first.Id, Qty__c = 1);
}
