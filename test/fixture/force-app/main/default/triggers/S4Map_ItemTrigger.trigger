// Fixture for the static map: a trigger on the object the S4Map_ controller writes.
trigger S4Map_ItemTrigger on S4Map_Item__c (before insert) {
    for (S4Map_Item__c i : Trigger.new) {
        i.Note__c = 'trigger';
    }
}
