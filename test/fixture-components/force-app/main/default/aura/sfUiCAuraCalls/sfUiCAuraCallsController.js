({
    openAlert: function (cmp, event, helper) {
        helper.openAlert(cmp);
    },
    openConfirm: function (cmp, event, helper) {
        helper.openConfirm(cmp);
    },
    openPrompt: function (cmp, event, helper) {
        helper.openPrompt(cmp);
    },
    openModal: function (cmp) {
        $A.createComponent('lightning:formattedText', { value: 'SFUIC modal body' }, function (body) {
            cmp.find('overlay').showCustomModal({ header: 'SFUIC Modal', body: body, showCloseButton: true }).then(function () {
                cmp.set('v.result', 'modal opened');
            });
        });
    },
    openPopover: function (cmp) {
        $A.createComponent('lightning:formattedText', { value: 'SFUIC popover body' }, function (body) {
            cmp.find('overlay').showCustomPopover({ body: body, referenceSelector: '.popover-anchor', cssClass: 'slds-popover' }).then(function () {
                cmp.set('v.result', 'popover opened');
            });
        });
    },
    showToast: function (cmp) {
        cmp.find('notify').showToast({ title: 'SFUIC Toast', message: 'SFUIC toast message', variant: 'success' });
        cmp.set('v.result', 'toast shown');
    },
    showNotice: function (cmp) {
        cmp.find('notify').showNotice({ header: 'SFUIC Notice', message: 'SFUIC notice message', variant: 'info' }).then(function () {
            cmp.set('v.result', 'notice closed');
        });
    },
    navigate: function (cmp) {
        cmp.find('nav').navigate({ type: 'standard__objectPage', attributes: { objectApiName: 'SfUiC_Aura__c', actionName: 'list' }, state: { filterName: 'All' } });
    },
    markDirty: function (cmp) {
        cmp.find('unsaved').setUnsavedChanges(true, { label: 'SFUIC Aura Calls' });
        cmp.set('v.dirty', true);
    },
    clearDirty: function (cmp) {
        cmp.find('unsaved').setUnsavedChanges(false);
        cmp.set('v.dirty', false);
    },
    unsavedSave: function (cmp) {
        cmp.find('unsaved').setUnsavedChanges(false);
        cmp.set('v.dirty', false);
        cmp.set('v.result', 'unsaved save');
    },
    unsavedDiscard: function (cmp) {
        cmp.find('unsaved').setUnsavedChanges(false);
        cmp.set('v.dirty', false);
        cmp.set('v.result', 'unsaved discard');
    },
    startFlow: function (cmp) {
        cmp.find('flow').startFlow('SfUiC_Utility_Flow');
    },
    flowStatus: function (cmp, event) {
        cmp.set('v.flowStatus', event.getParam('status'));
    }
});
