({
    // The aura:import openers live on the helper's this, as the reference examples call them.
    openAlert: function (cmp) {
        this.LightningAlert.open({ message: 'SFUIC alert message', theme: 'info', label: 'SFUIC Alert' }).then(function () {
            cmp.set('v.result', 'alert closed');
        });
    },
    openConfirm: function (cmp) {
        this.LightningConfirm.open({ message: 'SFUIC confirm message', theme: 'warning', label: 'SFUIC Confirm' }).then(function (ok) {
            cmp.set('v.result', 'confirm ' + ok);
        });
    },
    openPrompt: function (cmp) {
        this.LightningPrompt.open({ message: 'SFUIC prompt message', label: 'SFUIC Prompt', defaultValue: 'SFUIC answer' }).then(function (value) {
            cmp.set('v.result', 'prompt ' + value);
        });
    }
});
