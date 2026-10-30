/** Gradle signing for the generated Tauri Android project. */

export function escapePropertiesValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

export function keystoreProperties({ keyAlias, password, keyPassword, storeFile }) {
  return [
    `keyAlias=${escapePropertiesValue(keyAlias)}`,
    `password=${escapePropertiesValue(password)}`,
    `keyPassword=${escapePropertiesValue(keyPassword)}`,
    `storeFile=${escapePropertiesValue(storeFile)}`,
    '',
  ].join('\n');
}

const SIGNING_BLOCK = `    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            keyAlias = keystoreProperties["keyAlias"] as String
            storePassword = keystoreProperties["password"] as String
            keyPassword = (keystoreProperties["keyPassword"] ?: keystoreProperties["password"]) as String
            storeFile = file(keystoreProperties["storeFile"] as String)
        }
    }

`;

/**
 * Tauri's Android template does not sign release builds. Gradle reads
 * src-tauri/gen/android/keystore.properties only after this block is inserted
 * into app/build.gradle.kts. Idempotent: a second run leaves the file as-is.
 */
export function patchReleaseSigning(source) {
  let text = source;
  if (!text.includes('import java.io.FileInputStream')) {
    text = `import java.io.FileInputStream\n${text}`;
  }
  if (!text.includes('signingConfigs')) {
    const marker = text.match(/^[ \t]*buildTypes \{/m);
    if (!marker || marker.index === undefined) {
      throw new Error('buildTypes block not found in app/build.gradle.kts');
    }
    text = text.slice(0, marker.index) + SIGNING_BLOCK + text.slice(marker.index);
  }
  if (!text.includes('signingConfig = signingConfigs.getByName("release")')) {
    const release = /getByName\("release"\) \{\n/;
    if (!release.test(text)) {
      throw new Error('release build type not found in app/build.gradle.kts');
    }
    text = text.replace(
      release,
      (match) => `${match}            signingConfig = signingConfigs.getByName("release")\n`,
    );
  }
  return text;
}
