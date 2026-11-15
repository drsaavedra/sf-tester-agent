({
    invoke: function () {
        return new Promise(function (resolve) {
            $A.get('e.force:showToast').setParams({ title: 'SFUIC Aura Local Action', message: 'lightning:availableForFlowActions ran', type: 'success' }).fire();
            resolve();
        });
    }
});
