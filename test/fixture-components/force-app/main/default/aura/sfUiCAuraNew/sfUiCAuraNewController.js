({
    init: function (cmp) {
        cmp.set('v.fields', ['Name', 'Stage__c', 'Note__c']);
    },
    done: function (cmp, event) {
        cmp.find('nav').navigate({
            type: 'standard__recordPage',
            attributes: { recordId: event.getParam('response').id, objectApiName: 'SfUiC_Aura__c', actionName: 'view' }
        });
    },
    cancel: function (cmp) {
        cmp.find('nav').navigate({
            type: 'standard__objectPage',
            attributes: { objectApiName: 'SfUiC_Aura__c', actionName: 'home' }
        });
    }
});
