({
    open: function (cmp) {
        cmp.find('nav').navigate({
            type: 'standard__component',
            attributes: { componentName: 'c__sfUiCAuraAddress' },
            state: { c__note: 'SFUIC from lightning:navigation' }
        });
    }
});
