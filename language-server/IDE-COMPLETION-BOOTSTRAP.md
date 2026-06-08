# Enabling context-aware completion (one-time Eclipse bootstrap)

The language server currently runs with Xtext's generic `DefaultIdeModule`
(see `SymboleoLspSetup.java`). That gives parsing, diagnostics, hover,
formatting, semantic tokens, etc. — but **content-assist completion returns
no proposals**, because grammar-driven completion needs the
content-assist ANTLR parser that lives in the **`.ide` project's `src-gen/`**,
which upstream does NOT check in.

This file is the recipe to generate that code once in Eclipse and flip the
server over to the project's real `SymboleoIdeSetup`, which yields full
context-aware completion (keywords, valid next-tokens, cross-references).

> Why Eclipse and not Maven: the Xtext grammar generator (MWE2) needs the
> patched ANTLR generator and an `IJvmTypeProvider.Factory` binding that
> Eclipse wires up at runtime. Running it headlessly on JDK 17+ is
> unreliable (see `upstream/SymboleoAC-IDE/cli/README.md`). The runtime
> project's `src-gen/` is already committed; only the `.ide` project's is
> missing.

## Steps (do once)

1. Install **Eclipse IDE for Java and DSL Developers**, or any Eclipse with the
   **Xtext Complete SDK** installed. Pin the Xtext SDK to **2.36.0** so the
   generated `.xtextbin`/parser match the Maven build:
   `Help → Install New Software →`
   `https://download.eclipse.org/modeling/tmf/xtext/updates/releases/2.36.0/`

2. `File → Import → General → Existing Projects into Workspace`, point at
   `upstream/SymboleoAC-IDE/`, and import all five
   `ca.uottawa.csmlab.symboleo*` projects.

3. **`.project`/`.classpath` are git-ignored upstream, so a fresh checkout
   shows NO projects in the import dialog.** They have already been generated
   for all five projects on this machine (Xtext plug-in natures + JRE +
   `org.eclipse.pde.core.requiredPlugins` containers); empty `src-gen`/
   `xtend-gen` folders were created so nothing errors on import. If you ever
   re-clone, regenerate them — the generator is recorded in the project
   history (a PowerShell loop writing `.project`/`.classpath` per project).
   Requires the **Xtext Complete SDK** + **Xtend SDK** installed so the PDE
   "Plug-in Dependencies" container resolves `org.eclipse.xtext*` and
   `org.eclipse.emf.mwe2.*` from the target platform.

4. In the Project Explorer, expand
   `ca.uottawa.csmlab.symboleo/src/ca/uottawa/csmlab/symboleo/`,
   right-click **`GenerateSymboleo.mwe2` → Run As → MWE2 Workflow**.
   Wait for `Done.` in the console.

   > **Gotcha (fixed):** MWE2 fails with
   > `NoClassDefFoundError: org/apache/commons/logging/LogFactory`
   > because `org.eclipse.emf.mwe.core` needs Apache Commons Logging but the
   > runtime MANIFEST didn't import it. Fixed by adding
   > `org.apache.commons.logging` to `Import-Package` in
   > `ca.uottawa.csmlab.symboleo/META-INF/MANIFEST.MF`. If you re-clone, re-add
   > it. After editing the MANIFEST, refresh the project (F5) and re-run the
   > workflow. (Import-Package, not Require-Bundle, so it resolves whether your
   > Eclipse ships `org.apache.commons.logging` or
   > `org.apache.commons.commons-logging`.)

5. Confirm these now exist (generated):
   - `ca.uottawa.csmlab.symboleo.ide/src-gen/.../AbstractSymboleoIdeModule.java`
   - `ca.uottawa.csmlab.symboleo.ide/src-gen/.../contentassist/antlr/internal/InternalSymboleoParser.java`
   - `ca.uottawa.csmlab.symboleo.ide/src-gen/.../contentassist/antlr/SymboleoParser.java`
   - plus `*.tokens`, `*.g` under that `contentassist/antlr/internal/` dir.

6. **Commit `ca.uottawa.csmlab.symboleo.ide/src-gen/` into the repo.** (It is
   not in upstream's `.gitignore`-honored tree, so add it explicitly.)

## Then tell me "ide src-gen is committed"

I will apply these two edits to `language-server/` and rebuild — both are
already prepared and verified against the file layout above:

### Edit 1 — `language-server/pom.xml`: add the `.ide` sources

Add an `add-ide-sources` execution alongside `add-runtime-sources`, and add
the `.ide/src-gen` resource for the content-assist `*.tokens`/`*.g`/`.xtextbin`:

```xml
<!-- under build-helper-maven-plugin <executions> -->
<execution>
  <id>add-ide-sources</id>
  <phase>generate-sources</phase>
  <goals><goal>add-source</goal></goals>
  <configuration>
    <sources>
      <source>${ide.project.dir}/src</source>
      <source>${ide.project.dir}/src-gen</source>
    </sources>
  </configuration>
</execution>
```

with `<ide.project.dir>${upstream.dir}/ca.uottawa.csmlab.symboleo.ide</ide.project.dir>`
in `<properties>`, and the content-assist metadata added to `<resources>`:

```xml
<resource>
  <directory>${ide.project.dir}/src-gen</directory>
  <includes>
    <include>**/*.tokens</include>
    <include>**/*.g</include>
  </includes>
</resource>
```

The pom already depends on `org.eclipse.xtext.ide` and `org.antlr:antlr-runtime`
(transitively), which is all the content-assist parser needs at runtime.

### Edit 2 — switch the ISetup to the real IDE setup

`SymboleoLspSetup.java` becomes a thin subclass of the generated
`SymboleoIdeSetup` (which mixes `SymboleoRuntimeModule` + the **real**
`SymboleoIdeModule`, not `DefaultIdeModule`), keeping only the headless
validator re-registration:

```java
public class SymboleoLspSetup extends ca.uottawa.csmlab.symboleo.ide.SymboleoIdeSetup {
    @Override
    public Injector createInjectorAndDoEMFRegistration() {
        Injector injector = super.createInjectorAndDoEMFRegistration();
        EValidatorRegistrar registrar = injector.getInstance(EValidatorRegistrar.class);
        registrar.register(SymboleoPackage.eINSTANCE,
                injector.getInstance(SymboleoValidator.class));
        return injector;
    }
}
```

Then `mvn -B clean package` and re-run `node test-completion.mjs` — it should
return keyword/cross-reference proposals instead of 0.
```
