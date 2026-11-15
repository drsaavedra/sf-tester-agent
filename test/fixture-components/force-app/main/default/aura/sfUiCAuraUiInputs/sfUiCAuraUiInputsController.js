({
    init: function (cmp) {
        cmp.set('v.errs', ['SFUIC ui error text']);
    },
    press: function (cmp) {
        cmp.set('v.pressed', cmp.get('v.pressed') + 1);
    }
});
