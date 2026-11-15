({
    init: function (cmp) {
        cmp.set('v.stamp', new Date('2026-03-15T09:45:00Z').getTime());
        cmp.set('v.hourAgo', Date.now() - 3600000);
        cmp.set('v.richText', '<p><b>SFUIC rich</b> text with <i>italic</i> and a <a href="https://www.example.com">link</a></p><ul><li>One</li><li>Two</li></ul>');
        cmp.set('v.markers', [
            { location: { Street: '1 Market St', City: 'San Francisco', State: 'CA' }, title: 'SFUIC Map One' },
            { location: { Street: '415 Mission St', City: 'San Francisco', State: 'CA' }, title: 'SFUIC Map Two' }
        ]);
    }
});
