// Slice 11 sample data (safe to run twice). Part B1: three SFUIC Guard records for the
// Guard record page, its custom button and the list button that runs on selected rows.
List<SfUiC_Guard__c> guards = new List<SfUiC_Guard__c>();
Set<String> haveGuards = new Set<String>();
for (SfUiC_Guard__c g : [SELECT Name FROM SfUiC_Guard__c WHERE Name LIKE 'SFUIC Guard %']) {
    haveGuards.add(g.Name);
}
for (Integer i = 1; i <= 3; i++) {
    String name = 'SFUIC Guard ' + i;
    if (!haveGuards.contains(name)) {
        guards.add(new SfUiC_Guard__c(Name = name));
    }
}
insert guards;
System.debug('SfUiC_Guard__c made: ' + guards.size() + ', skipped: ' + haveGuards.size());

// Part B2: standard Lightning UI shapes. Run as the admin; every record is named SFUIC.
Database.DMLOptions allowDupes = new Database.DMLOptions();
allowDupes.DuplicateRuleHeader.allowSave = true;

// Convert Lead (A1-240), save options (A1-254) and two duplicates to merge (A1-249).
if ([SELECT COUNT() FROM Lead WHERE LastName = 'SFUIC Lead' AND IsConverted = false] == 0) {
    Database.insert(new Lead(FirstName = 'Sam', LastName = 'SFUIC Lead', Company = 'SFUIC Lead Co',
        Email = 'lead@sfuic.example'), allowDupes);
}
List<Lead> dupLeads = new List<Lead>();
for (Integer i = [SELECT COUNT() FROM Lead WHERE LastName = 'SFUIC Dup Lead' AND IsConverted = false]; i < 2; i++) {
    dupLeads.add(new Lead(FirstName = 'Dana', LastName = 'SFUIC Dup Lead', Company = 'SFUIC Dup Co',
        Email = 'dup@sfuic.example'));
}
Database.insert(dupLeads, allowDupes);

// Add Products (A1-250): a product, its standard price, an SFUIC price book and an opportunity on it.
Product2 prod;
List<Product2> prods = [SELECT Id FROM Product2 WHERE Name = 'SFUIC Product' LIMIT 1];
if (prods.isEmpty()) {
    prod = new Product2(Name = 'SFUIC Product', ProductCode = 'SFUIC-1', IsActive = true);
    insert prod;
} else {
    prod = prods[0];
}
Id stdPb = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
if ([SELECT COUNT() FROM PricebookEntry WHERE Pricebook2Id = :stdPb AND Product2Id = :prod.Id] == 0) {
    insert new PricebookEntry(Pricebook2Id = stdPb, Product2Id = prod.Id, UnitPrice = 100, IsActive = true);
}
Pricebook2 pb;
List<Pricebook2> pbs = [SELECT Id FROM Pricebook2 WHERE Name = 'SFUIC Price Book' LIMIT 1];
if (pbs.isEmpty()) {
    pb = new Pricebook2(Name = 'SFUIC Price Book', IsActive = true);
    insert pb;
} else {
    pb = pbs[0];
}
if ([SELECT COUNT() FROM PricebookEntry WHERE Pricebook2Id = :pb.Id AND Product2Id = :prod.Id] == 0) {
    insert new PricebookEntry(Pricebook2Id = pb.Id, Product2Id = prod.Id, UnitPrice = 90, IsActive = true);
}
if ([SELECT COUNT() FROM Opportunity WHERE Name = 'SFUIC Opp Products'] == 0) {
    insert new Opportunity(Name = 'SFUIC Opp Products', StageName = 'Prospecting',
        CloseDate = Date.today().addDays(30), Pricebook2Id = pb.Id);
}

// Account Hierarchy (A1-251): one parent with two children.
Account parentAcct;
List<Account> parents = [SELECT Id FROM Account WHERE Name = 'SFUIC Parent Account' LIMIT 1];
if (parents.isEmpty()) {
    parentAcct = new Account(Name = 'SFUIC Parent Account');
    Database.insert(parentAcct, allowDupes);
} else {
    parentAcct = parents[0];
}
List<Account> children = new List<Account>();
for (String n : new List<String>{ 'SFUIC Child Account 1', 'SFUIC Child Account 2' }) {
    if ([SELECT COUNT() FROM Account WHERE Name = :n] == 0) {
        children.add(new Account(Name = n, ParentId = parentAcct.Id));
    }
}
Database.insert(children, allowDupes);

// Calendar (A1-241): two events for the running user, tomorrow.
List<Event> events = new List<Event>();
for (Integer i = 1; i <= 2; i++) {
    String subj = 'SFUIC Event ' + i;
    if ([SELECT COUNT() FROM Event WHERE Subject = :subj] == 0) {
        Datetime startAt = Datetime.newInstance(Date.today().addDays(1), Time.newInstance(8 + 2 * i, 0, 0, 0));
        events.add(new Event(Subject = subj, StartDateTime = startAt, EndDateTime = startAt.addHours(1)));
    }
}
insert events;

// Files home and preview (A1-253): one small text file.
if ([SELECT COUNT() FROM ContentVersion WHERE Title = 'SFUIC File' AND IsLatest = true] == 0) {
    insert new ContentVersion(Title = 'SFUIC File', PathOnClient = 'SFUIC File.txt',
        VersionData = Blob.valueOf('SFUIC File: a small text file for the Files home and the preview player.'));
}

// Recycle Bin (A1-248): one SFUIC Guard made here and deleted, so the bin holds it (for 15 days).
if ([SELECT COUNT() FROM SfUiC_Guard__c WHERE Name = 'SFUIC Recycled Guard' AND IsDeleted = true ALL ROWS] == 0) {
    List<SfUiC_Guard__c> live = [SELECT Id FROM SfUiC_Guard__c WHERE Name = 'SFUIC Recycled Guard'];
    if (live.isEmpty()) {
        live.add(new SfUiC_Guard__c(Name = 'SFUIC Recycled Guard'));
        insert live;
    }
    delete live;
}

// Chatter Announcement (A4-018): one public group.
if ([SELECT COUNT() FROM CollaborationGroup WHERE Name = 'SFUIC Group'] == 0) {
    insert new CollaborationGroup(Name = 'SFUIC Group', CollaborationType = 'Public');
}

// Quick Text (A1-256): one message to insert.
if ([SELECT COUNT() FROM QuickText WHERE Name = 'SFUIC Quick Text'] == 0) {
    insert new QuickText(Name = 'SFUIC Quick Text', Message = 'SFUIC Quick Text: thank you for your message.',
        Channel = 'Email;Task;Event');
}
// Button overrides and cross-object fields (A1-242, A1-243, A1-255): one Override on SFUIC Guard 1.
List<SfUiC_Guard__c> guardOne = [SELECT Id FROM SfUiC_Guard__c WHERE Name = 'SFUIC Guard 1' LIMIT 1];
if (!guardOne.isEmpty() && [SELECT COUNT() FROM SfUiC_Ovr__c WHERE Name = 'SFUIC Override 1'] == 0) {
    insert new SfUiC_Ovr__c(Name = 'SFUIC Override 1', Guard__c = guardOne[0].Id);
}
System.debug('Part B2 seed done');
