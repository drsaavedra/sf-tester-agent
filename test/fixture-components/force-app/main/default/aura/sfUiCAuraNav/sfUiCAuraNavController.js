({
    init: function (cmp) {
        cmp.set('v.treeItems', [
            { label: 'SFUIC Branch One', name: 'b1', expanded: true, items: [
                { label: 'SFUIC Leaf One', name: 'l1', items: [] },
                { label: 'SFUIC Leaf Two', name: 'l2', items: [] }
            ] },
            { label: 'SFUIC Branch Two', name: 'b2', expanded: false, items: [
                { label: 'SFUIC Leaf Three', name: 'l3', items: [] }
            ] }
        ]);
        cmp.set('v.gridColumns', [
            { label: 'SFUIC Name', fieldName: 'name', type: 'text' },
            { label: 'SFUIC Amount', fieldName: 'amount', type: 'currency' }
        ]);
        cmp.set('v.gridData', [
            { name: 'SFUIC Parent One', amount: 300, _children: [
                { name: 'SFUIC Child One', amount: 100 },
                { name: 'SFUIC Child Two', amount: 200 }
            ] },
            { name: 'SFUIC Parent Two', amount: 50 }
        ]);
        cmp.set('v.gridExpanded', ['SFUIC Parent One']);
        cmp.set('v.tableColumns', [
            { label: 'SFUIC Name', fieldName: 'name', type: 'text', sortable: true },
            { label: 'SFUIC Email', fieldName: 'email', type: 'email' },
            { label: 'SFUIC Amount', fieldName: 'amount', type: 'currency' }
        ]);
        cmp.set('v.tableData', [
            { id: '1', name: 'SFUIC Row One', email: 'one@example.com', amount: 100 },
            { id: '2', name: 'SFUIC Row Two', email: 'two@example.com', amount: 250 },
            { id: '3', name: 'SFUIC Row Three', email: 'three@example.com', amount: 75 }
        ]);
    },
    crumb: function (cmp, event) {
        event.preventDefault();
        cmp.set('v.crumb', event.getSource().get('v.name'));
    },
    pickStep: function (cmp, event) {
        cmp.set('v.step', event.getSource().get('v.value'));
    },
    advance: function (cmp) {
        var p = cmp.get('v.percent');
        cmp.set('v.percent', p >= 100 ? 0 : p + 20);
    },
    navSelect: function (cmp, event) {
        cmp.set('v.navItem', event.getParam('name'));
    },
    treeSelect: function (cmp, event) {
        cmp.set('v.treePick', event.getParam('name'));
    },
    rowSelect: function (cmp, event) {
        var rows = event.getParam('selectedRows');
        cmp.set('v.tableRows', rows.length ? rows.map(function (r) { return r.name; }).join(', ') : 'none');
    }
});
