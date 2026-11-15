({
    pick: function (cmp, event) {
        cmp.set('v.picked', event.getSource().get('v.label'));
    }
});
