({
    init: function (cmp) {
        cmp.set('v.colours', [
            { label: 'SFUIC Red', value: 'red' },
            { label: 'SFUIC Green', value: 'green' },
            { label: 'SFUIC Blue', value: 'blue' }
        ]);
        cmp.set('v.salutations', [
            { label: 'Mr.', value: 'Mr.' },
            { label: 'Ms.', value: 'Ms.' },
            { label: 'Dr.', value: 'Dr.' }
        ]);
        cmp.set('v.dualOptions', [
            { label: 'SFUIC Alpha', value: 'a' },
            { label: 'SFUIC Beta', value: 'b' },
            { label: 'SFUIC Gamma', value: 'c' },
            { label: 'SFUIC Delta', value: 'd' }
        ]);
    }
});
