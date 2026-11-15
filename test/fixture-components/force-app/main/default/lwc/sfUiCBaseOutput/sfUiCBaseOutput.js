import { LightningElement } from 'lwc';

export default class SfUiCBaseOutput extends LightningElement {
    stamp = new Date('2026-03-15T09:45:00Z').getTime();
    hourAgo = Date.now() - 3600000;
    richText = '<p><b>SFUIC rich</b> text with <i>italic</i> and a <a href="https://www.example.com">link</a></p><ul><li>One</li><li>Two</li></ul>';
}
