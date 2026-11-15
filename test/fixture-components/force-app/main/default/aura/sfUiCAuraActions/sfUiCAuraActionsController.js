({
    init: function (cmp) {
        cmp.set('v.pills', [
            { type: 'icon', label: 'SFUIC Pill One', name: 'SFUIC Pill One', iconName: 'standard:account', alternativeText: 'Account' },
            { label: 'SFUIC Pill Two', name: 'SFUIC Pill Two' },
            { label: 'SFUIC Pill Three', name: 'SFUIC Pill Three' }
        ]);
    },
    press: function (cmp, event) {
        cmp.set('v.pressed', event.getSource().get('v.label') || event.getSource().get('v.alternativeText'));
    },
    toggleLike: function (cmp) {
        cmp.set('v.liked', !cmp.get('v.liked'));
    },
    toggleFollow: function (cmp) {
        cmp.set('v.followed', !cmp.get('v.followed'));
    },
    menuSelect: function (cmp, event) {
        cmp.set('v.menuPick', event.getParam('value'));
    },
    removePill: function (cmp, event) {
        cmp.set('v.pillRemoved', event.getSource().get('v.name'));
    },
    removeItem: function (cmp, event) {
        var name = event.getParam('item').name;
        cmp.set('v.pillRemoved', name);
        cmp.set('v.pills', cmp.get('v.pills').filter(function (p) { return p.name !== name; }));
    }
});
