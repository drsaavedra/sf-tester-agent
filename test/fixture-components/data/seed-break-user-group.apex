// Run after Dave creates Probe Breaker (safe to run twice). Adds him to the public group SFUIC Breakers,
// which shares the SFUIC report and dashboard folders. Then run seed-break-user-chatter.apex: GroupMember
// is a setup object, so the Chatter membership goes in its own transaction (no mixed DML).
List<User> breakers = [SELECT Id FROM User WHERE FirstName = 'Probe' AND LastName = 'Breaker' AND IsActive = true];
Group g = [SELECT Id FROM Group WHERE DeveloperName = 'SfUiC_Breakers' AND Type = 'Regular'];
Set<Id> have = new Set<Id>();
for (GroupMember m : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :g.Id]) {
    have.add(m.UserOrGroupId);
}
List<GroupMember> adds = new List<GroupMember>();
for (User u : breakers) {
    if (!have.contains(u.Id)) {
        adds.add(new GroupMember(GroupId = g.Id, UserOrGroupId = u.Id));
    }
}
insert adds;
System.debug('Probe Breaker users: ' + breakers.size() + ', added to SFUIC Breakers: ' + adds.size());
