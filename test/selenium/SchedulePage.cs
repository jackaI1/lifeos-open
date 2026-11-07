using System.Text.Json;
using OpenQA.Selenium;
using OpenQA.Selenium.Support.UI;
namespace LifeOS.BrowserTests;
public sealed class SchedulePage(IWebDriver driver) {
    public WebDriverWait Wait {get;} = new(driver, TimeSpan.FromSeconds(20));
    public void Open() {
        driver.Navigate().GoToUrl((Environment.GetEnvironmentVariable("LIFEOS_TEST_URL") ?? "http://127.0.0.1:8787") + "/#today");
        Wait.Until(d => d.FindElements(By.CssSelector("[data-schedule-id]")).Count > 0);
    }
    public IWebElement Button(string name) => Wait.Until(d => d.FindElements(By.TagName("button")).FirstOrDefault(e => e.Displayed && e.Enabled && (e.Text == name || e.GetAttribute("aria-label") == name)))!;
    public IWebElement Field(string label) => Wait.Until(d => d.FindElements(By.TagName("label")).Where(e => e.Text.Trim() == label).SelectMany(e => e.FindElements(By.CssSelector("input,textarea"))).FirstOrDefault(e => e.Displayed))!;
    public void Fill(string label,string value) {var input=Field(label); input.Clear(); input.SendKeys(value);}
    public void Save() {Button("Save event").Click(); Wait.Until(d => !d.FindElement(By.Id("dialog")).Displayed);}
    public JsonElement Api(string path) {
        var json=(string)((IJavaScriptExecutor)driver).ExecuteAsyncScript("const done=arguments[arguments.length-1]; fetch(arguments[0]).then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(done).catch(e=>done(JSON.stringify({error:String(e)})))", path);
        return JsonDocument.Parse(json).RootElement.Clone();
    }
    public JsonElement Today => Api("/api/bootstrap").GetProperty("today");
    public void EventVisible(string title) => Wait.Until(d => d.FindElements(By.CssSelector("[data-schedule-id] h3")).Any(e=>e.Text==title));
}
