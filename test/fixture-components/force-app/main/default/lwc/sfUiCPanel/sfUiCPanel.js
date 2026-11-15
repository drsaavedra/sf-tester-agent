import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class SfUiCPanel extends LightningElement {
    fileName;
    size = 'Small';
    sizes = [
        { label: 'Small', value: 'Small' },
        { label: 'Medium', value: 'Medium' },
        { label: 'Large', value: 'Large' }
    ];
    sampleHref = 'data:text/plain;charset=utf-8,SFUIC%20sample';

    toast(event) {
        const { variant, mode } = event.target.dataset;
        this.dispatchEvent(new ShowToastEvent({ title: `SFUIC ${mode || variant} toast`, message: `A ${variant} toast`, variant, mode: mode || 'dismissible' }));
    }

    toastLink() {
        this.dispatchEvent(new ShowToastEvent({
            title: 'SFUIC link toast',
            message: 'Open {0}',
            messageData: [{ url: '/lightning/o/SfUiC_Shape__c/home', label: 'SFUIC Shapes' }],
            variant: 'success'
        }));
    }

    pickFile(event) {
        const [file] = event.target.files;
        this.fileName = file ? file.name : undefined;
    }

    pickSize(event) {
        this.size = event.target.value;
    }
}
