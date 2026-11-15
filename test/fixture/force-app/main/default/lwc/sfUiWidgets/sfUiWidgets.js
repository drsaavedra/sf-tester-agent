import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue, batch 4: typed inputs (number, email, time, datetime, search), two
// stateful buttons and a vertical navigation, each echoing its result as text.
export default class SfUiWidgets extends LightningElement {
    quantity;
    email;
    time;
    meeting;
    find;
    following = false;
    liked = false;
    navItem = 'recent';
    navChosen = false;

    handleQuantity(event) {
        this.quantity = event.detail.value;
    }

    handleEmail(event) {
        this.email = event.target.checkValidity() ? event.detail.value : undefined;
    }

    handleTime(event) {
        this.time = (event.detail.value || '').slice(0, 5);
    }

    handleMeeting(event) {
        this.meeting = (event.detail.value || '').slice(0, 16);
    }

    handleFind(event) {
        this.find = event.detail.value;
    }

    handleFollow() {
        this.following = !this.following;
    }

    handleLike() {
        this.liked = !this.liked;
    }

    handleNav(event) {
        this.navItem = event.detail.name;
        this.navChosen = true;
    }
}
