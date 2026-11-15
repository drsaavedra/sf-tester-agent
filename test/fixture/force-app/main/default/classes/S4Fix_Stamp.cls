// Fixture: an invocable action with one observable effect, a stamped copy of each input text.
public with sharing class S4Fix_Stamp {
    @InvocableMethod(label='S4Fix Stamp')
    public static List<String> stamp(List<String> texts) {
        List<String> out = new List<String>();
        for (String t : texts) {
            if (String.isBlank(t)) throw new IllegalArgumentException('Text is required');
            out.add('stamped:' + t);
        }
        return out;
    }
}
