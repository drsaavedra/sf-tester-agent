// Fixture for the static map: the server call s4MapPanel makes, which writes an S4Map_Item__c.
public with sharing class S4Map_Controller {
    @AuraEnabled
    public static Id saveItem(String name, Decimal qty) {
        S4Map_Item__c item = new S4Map_Item__c(Name = name, Qty__c = qty);
        insert item;
        return item.Id;
    }
}
