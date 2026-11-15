<aura:application extends="force:slds">
    <aura:attribute name="count" type="Integer" default="0"/>
    <!-- Standalone app page opened at /c/sfUiCStandalone.app -->
    <div class="slds-p-around_medium" data-id="standalone-aura-app">
        <h1 class="slds-text-heading_medium">SFUIC Standalone App</h1>
        <lightning:button label="SFUIC Standalone Count" onclick="{!c.bump}"/>
        <p>Pressed: {!v.count}</p>
    </div>
</aura:application>
