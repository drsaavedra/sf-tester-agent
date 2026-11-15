({
    init: function (cmp) {
        // The note comes from the URL state (c__note); navigateToComponent sets the attribute instead
        var ref = cmp.get('v.pageReference');
        if (ref && ref.state && ref.state.c__note) { cmp.set('v.note', ref.state.c__note); }
    }
});
