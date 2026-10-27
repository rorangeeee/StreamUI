using System.Text.Json;

namespace StreamUI;

internal static class LayoutSelfTests
{
    public static void Run(Action<bool, string> check)
    {
        SavedLayout Layout(double x) => new([.. HostSettings.PanelIds], HostSettings.PanelIds.ToDictionary(id => id, _ => new PanelRect(x, .1, .2, .3, 0, false)));
        var original = Layout(.1); var wide = Layout(.2); var delayed = Layout(.3);
        var settings = (HostSettings.Default with { Layout = original }).SwitchLayout("16:9").UpdateLayout("16:9", wide).SwitchLayout("21:9");
        check(settings.Layout == original && settings.SwitchLayout("16:9").Layout == wide, "layout modes preserve independent edits and legacy 21:9 geometry");
        var late = settings.UpdateLayout("16:9", delayed);
        check(late.Layout == original && late.LayoutMode == "21:9" && late.SwitchLayout("16:9").Layout == delayed, "late editor saves remain attached to their originating layout");
        var restored = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(late, SettingsStore.Json), SettingsStore.Json)!;
        check(restored.SwitchLayout("16:9").Layout!.Windows["chat-window"].X == .3, "layout profiles survive serialization and restart");
        var legacy = JsonSerializer.Deserialize<HostSettings>("{\"audio\":{},\"laplace\":{},\"canvas\":{},\"layout\":null,\"layoutVersion\":3}", SettingsStore.Json)!;
        legacy.Validate();
        check(legacy.LayoutMode == "21:9" && !legacy.Obs.Enabled, "existing v3 settings adopt layout switching with OBS automation disabled");
        check(!legacy.Away.Enabled && legacy.Away.OverlayOpacity == .5 && legacy.Away.Text2 == "", "existing settings adopt a disabled away banner with a 50 percent mask and an empty second slot");
        var away = HostSettings.Default with { Away = new(true, "主播暂离 BRB", "稍后回来", .65) };
        away.Validate();
        var savedAway = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(away, SettingsStore.Json), SettingsStore.Json)!;
        check(savedAway.Away == away.Away, "away mode, both paragraphs and mask opacity survive serialization");
        foreach (var invalidAway in new[] { new AwaySettings(Text1: " "), new AwaySettings(Text2: "bad\nline"), new AwaySettings(OverlayOpacity: -1), new AwaySettings(OverlayOpacity: double.NaN), new AwaySettings(Text1: new string('A', 501)) })
        {
            bool rejected = false;
            try { (HostSettings.Default with { Away = invalidAway }).Validate(); } catch (ArgumentException) { rejected = true; }
            check(rejected, "invalid away text and mask opacity are rejected");
        }
        check(new ObsSettings().ModeForScene("") is null && !new ObsSettings(Scene16: "  ").Enabled, "empty scene names disable automatic layout switching");
        var obs = new ObsSettings(Scene21: "宽屏", Scene16: "游戏");
        check(obs.ModeForScene("游戏") == "16:9" && obs.ModeForScene("宽屏") == "21:9" && obs.ModeForScene("其他") is null && obs.ModeForScene("游戏2") is null,
            "OBS scene mappings are exact and unrelated scenes retain the selected layout");
        foreach (var bad in new[] { HostSettings.Default with { LayoutMode = "bad" }, HostSettings.Default with { Obs = new(Scene21: "同名", Scene16: "同名") } })
        {
            bool rejected = false;
            try { bad.Validate(); } catch (ArgumentException) { rejected = true; }
            check(rejected, "invalid modes and ambiguous OBS scene mappings are rejected");
        }
        var publicJson = JsonSerializer.Serialize(HostSettings.Default with { Obs = new(Password: "secret-test") }, SettingsStore.Json);
        var publicState = JsonSerializer.Serialize((HostSettings.Default with { Obs = new(Password: "secret-test") }).Public(), SettingsStore.Json);
        check(publicJson.Contains("secret-test") && !publicState.Contains("secret-test"), "OBS credentials are saved locally and excluded from display state");
    }
}
