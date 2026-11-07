using NUnit.Framework;
using NUnit.Framework.Interfaces;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
namespace LifeOS.BrowserTests;
public abstract class BrowserFixture {
    protected IWebDriver Driver=null!;
    protected SchedulePage Page=null!;
    [SetUp] public void Start() {
        var options=new ChromeOptions(); options.AddArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000");
        Driver=new ChromeDriver(options);Driver.Manage().Timeouts().AsynchronousJavaScript=TimeSpan.FromSeconds(15);Page=new SchedulePage(Driver);Page.Open();
    }
    [TearDown] public void Stop() {
        try {if(TestContext.CurrentContext.Result.Outcome.Status==TestStatus.Failed) {var file=Path.Combine(TestContext.CurrentContext.WorkDirectory,TestContext.CurrentContext.Test.ID+".png");((ITakesScreenshot)Driver).GetScreenshot().SaveAsFile(file);TestContext.AddTestAttachment(file);}}
        finally {Driver?.Quit();Driver?.Dispose();}
    }
}
[TestFixture, NonParallelizable] public class ScheduleTests:BrowserFixture {
    [Test] public void LoadAddEditAndReloadEvent() {
        var title="Selenium fictional lab "+Guid.NewGuid().ToString("N")[..8];
        Page.Button("Add event").Click();Page.Fill("Event title",title);Page.Fill("Start time","16:00");Page.Fill("End time","17:00");Page.Save();Page.EventVisible(title);
        Page.Button(title).Click();Page.Button("Edit event").Click();Page.Fill("Event title",title+" revised");Page.Save();Page.EventVisible(title+" revised");
        Driver.Navigate().Refresh();Page.EventVisible(title+" revised");
        var item=Page.Api("/api/bootstrap").GetProperty("records").GetProperty("calendar-event").EnumerateArray().Single(r=>r.GetProperty("data").GetProperty("title").GetString()==title+" revised");
        Assert.That(item.GetProperty("data").GetProperty("start").ToString(),Does.Contain(Page.Today.GetProperty("date").GetString()));
    }
    [Test] public void UserEnteredMarkupDisplaysAsText() {
        const string title="<img src=x onerror=window.lifeosXss=true>";
        Page.Button("Add event").Click();Page.Fill("Event title",title);Page.Save();Page.EventVisible(title);
        Assert.That(((IJavaScriptExecutor)Driver).ExecuteScript("return window.lifeosXss === true"),Is.False);
        Assert.That(Driver.FindElements(By.CssSelector("[data-schedule-id] h3 img")).Count,Is.Zero);
    }
}
[TestFixture, NonParallelizable] public class DataValidationTests:BrowserFixture {
    [Test] public void DisplayedScheduleCountDatesAndTitlesMatchApi() {
        var today=Page.Today;var entries=today.GetProperty("timeline").EnumerateArray().Where(r=>!r.TryGetProperty("hidden",out var hidden)||!hidden.GetBoolean()).ToArray();
        var rows=Driver.FindElements(By.CssSelector("[data-schedule-id]"));
        Assert.That(rows.Count,Is.EqualTo(entries.Length));
        foreach(var entry in entries) {
            var row=rows.Single(e=>e.GetAttribute("data-schedule-id")==entry.GetProperty("id").GetString());
            Assert.That(row.GetAttribute("data-schedule-start"),Is.EqualTo(entry.GetProperty("start").GetString()));
            Assert.That(row.FindElement(By.TagName("h3")).Text,Is.EqualTo(entry.GetProperty("title").GetString()));
            Assert.That(row.FindElement(By.TagName("time")).GetAttribute("datetime"),Is.EqualTo(entry.GetProperty("start").GetString()));
        }
    }
}
