import { LightningElement } from 'lwc';

export default class SfUiCChildren extends LightningElement {
    menuChoice = 'none';
    richText = '<p>SFUIC Rich Text</p>';
    richClicks = 0;
    navItem = 'inbox';

    handleMenu(event) {
        this.menuChoice = event.detail.value;
    }

    handleRich(event) {
        this.richText = event.target.value;
    }

    clearRich() {
        this.richClicks += 1;
        this.richText = '';
    }

    handleNav(event) {
        this.navItem = event.detail.name;
    }
}
