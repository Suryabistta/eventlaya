import java.io.FileInputStream
import java.util.Properties

// Release signing: android/key.properties on a developer machine (made by tool/make_upload_keystore.sh,
// gitignored), or ANDROID_KEYSTORE_* environment variables in CI. With neither, release builds stay UNSIGNED
// instead of going out with Flutter's shared debug key: Play refuses those, and anyone could sign as this app.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) load(FileInputStream(keystorePropertiesFile))
}
fun signingValue(prop: String, env: String): String? =
    (keystoreProperties[prop] as String?)?.takeIf { it.isNotBlank() } ?: System.getenv(env)?.takeIf { it.isNotBlank() }
val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
val hasReleaseSigning = releaseStoreFile != null

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.eventlaya.eventlaya_scanner"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.eventlaya.eventlaya"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS") ?: "upload"
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
                    ?: signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // Deliberately null without a key: an unsigned build fails loudly instead of looking releasable
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release") else null
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
