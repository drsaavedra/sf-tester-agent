({
    init: function (cmp) {
        // lightning:quipCard asks for a 15 character record id
        cmp.set('v.recordId15', (cmp.get('v.recordId') || '').substring(0, 15));
    },
    saved: function (cmp, event) {
        cmp.set('v.saved', event.getParam('response').fields.Name.value);
    },
    uploaded: function (cmp, event) {
        var files = event.getParam('files');
        cmp.set('v.uploaded', files.map(function (f) { return f.name; }).join(', '));
        cmp.set('v.uploadedId', files[0].documentId);
    }
});
