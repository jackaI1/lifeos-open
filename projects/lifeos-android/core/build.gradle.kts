plugins { kotlin("jvm"); kotlin("plugin.serialization") }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    testImplementation("junit:junit:4.13.2")
}
tasks.register<JavaExec>("demoCheck") {
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("ca.jacklai.lifeos.core.DemoCheckKt")
}
