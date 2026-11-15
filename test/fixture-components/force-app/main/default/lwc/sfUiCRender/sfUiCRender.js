import { LightningElement } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { loadScript } from 'lightning/platformResourceLoader';
import CHART from '@salesforce/resourceUrl/SfUiC_Chart';
import CONTAINER from '@salesforce/resourceUrl/SfUiC_Container';

export default class SfUiCRender extends NavigationMixin(LightningElement) {
    chartStatus = 'loading';
    dialogStatus = 'closed';
    editedText = '(not edited)';
    dropped = 'nothing';
    frameUrl = CONTAINER + '/index.html';
    chartLoaded = false;

    renderedCallback() {
        if (this.chartLoaded) return;
        this.chartLoaded = true;
        loadScript(this, CHART)
            .then(() => {
                window.sfuicDrawBars(this.refs.chart, [3, 5, 2, 6]);
                this.chartStatus = 'drawn, 4 bars';
            })
            .catch((e) => {
                this.chartStatus = 'failed: ' + (e?.message || e);
            });
    }

    openDialog() {
        this.refs.dialog.showModal();
        this.dialogStatus = 'open';
    }

    closeDialog() {
        this.refs.dialog.close();
        this.dialogStatus = 'closed';
    }

    edited(event) {
        this.editedText = event.target.textContent;
    }

    dragStart(event) {
        event.dataTransfer.setData('text/plain', 'SFUIC Drag me');
    }

    dragOver(event) {
        event.preventDefault();
    }

    drop(event) {
        event.preventDefault();
        this.dropped = event.dataTransfer.getData('text/plain');
    }

    openUrl() {
        this[NavigationMixin.Navigate]({
            type: 'standard__component',
            attributes: { componentName: 'c__sfUiCUrl' },
            state: { c__name: 'SFUIC Button' }
        });
    }
}
