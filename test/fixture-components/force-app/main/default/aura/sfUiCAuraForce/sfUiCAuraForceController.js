({
    save: function (cmp) {
        cmp.find('edit').get('e.recordSave').fire();
    },
    saved: function (cmp) {
        cmp.set('v.saved', new Date().toLocaleTimeString());
    }
});
