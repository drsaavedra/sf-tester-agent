({
    init: function (cmp) {
        cmp.set('v.events', ['force:createRecord', 'force:editRecord', 'force:navigateHome', 'force:navigateToComponent', 'force:navigateToList', 'force:navigateToObjectHome', 'force:navigateToRelatedList', 'force:navigateToSObject', 'force:navigateToURL', 'force:refreshView', 'force:showToast', 'lightning:openFiles']);
    },
    fire: function (cmp, event) {
        var name = event.getSource().get('v.name');
        var id = cmp.get('v.recordId');
        var rec = cmp.get('v.rec') || {};
        var params = {
            'force:createRecord': { entityApiName: 'SfUiC_Aura__c', defaultFieldValues: { Name: 'SFUIC Aura Created' } },
            'force:editRecord': { recordId: id },
            'force:navigateHome': {},
            'force:navigateToComponent': { componentDef: 'c:sfUiCAuraAddress', componentAttributes: { note: 'SFUIC from force:navigateToComponent' } },
            'force:navigateToList': { listViewName: 'All', scope: 'SfUiC_Aura__c' },
            'force:navigateToObjectHome': { scope: 'SfUiC_Aura__c' },
            'force:navigateToRelatedList': { relatedListId: 'AttachedContentDocuments', parentRecordId: id },
            'force:navigateToSObject': { recordId: id, slideDevName: 'detail' },
            'force:navigateToURL': { url: '/lightning/n/SfUiC_Aura_Host' },
            'force:refreshView': {},
            'force:showToast': { title: 'SFUIC Toast', message: 'SFUIC Aura force:showToast', type: 'success' },
            'lightning:openFiles': { recordIds: [rec.File_Id__c] }
        }[name];
        $A.get('e.' + name).setParams(params).fire();
        cmp.set('v.last', name);
    },
    refreshed: function (cmp) {
        cmp.set('v.refreshed', cmp.get('v.refreshed') + 1);
    }
});
