// Generates fixtures/synthetic.OL-template — a minimal but valid
// PlanetPress Connect template archive used by the Playwright smoke test.
//
// Run from template-editor/:
//   node fixtures/make-fixture.mjs
//
// Contents:
//   index.xml  — three <script> blocks: one field-text (TEXT), one
//                conditional (CONDITIONAL), one control (CONTROL)
//   OL-datamodel.OL-datamodel — tiny datamodel with CustomerName + IsActive

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, 'synthetic.OL-template');

const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <scripts>
                <script type="STANDARD">
                <com.objectiflune.scripting.text.TextScriptModel schemaVersion="1.0.0.1">
                    <entry>
                        <field>
                            <path>CustomerName</path>
                            <type>STRING</type>
                        </field>
                        <fieldFormatString>
                            <type>NONE</type>
                        </fieldFormatString>
                        <format type="NONE"/>
                        <prefix></prefix>
                        <suffix></suffix>
                    </entry>
                    <attribute></attribute>
                    <convertToJSON>false</convertToJSON>
                    <insertMethod>HTML</insertMethod>
                </com.objectiflune.scripting.text.TextScriptModel>
                <enabled>true</enabled>
                <findText>@CustomerName@</findText>
                <name>CustomerName</name>
                <origin/>
                <scope>RESULT_SET</scope>
                <selectorText></selectorText>
                <selectorType>TEXT</selectorType>
                <source></source>
                </script>
                <script type="STANDARD">
                <com.objectiflune.scripting.conditional.ConditionalScriptModel schemaVersion="1.0.0.1">
                    <field>
                        <path>IsActive</path>
                        <type>BOOLEAN</type>
                    </field>
                    <value>true</value>
                    <condition>EQUAL_TO</condition>
                    <action>SHOW</action>
                    <caseInsensitive>false</caseInsensitive>
                    <toggleVisibility>true</toggleVisibility>
                </com.objectiflune.scripting.conditional.ConditionalScriptModel>
                <enabled>true</enabled>
                <findText>@IsActive@</findText>
                <name>ShowIfActive</name>
                <origin/>
                <scope>RESULT_SET</scope>
                <selectorText></selectorText>
                <selectorType>TEXT</selectorType>
                <source></source>
                </script>
                <script type="CONTROL">
                <enabled>true</enabled>
                <findText></findText>
                <name>PageController</name>
                <origin/>
                <scope>NONE</scope>
                <selectorText></selectorText>
                <selectorType>QUERY</selectorType>
                <source>// page control script</source>
                </script>
  </scripts>
</root>
`;

const DATAMODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<datamodel>
  <configs>
    <field name="CustomerName" type="string" lastValue="Acme Corp"/>
    <field name="IsActive" type="boolean" lastValue="true"/>
  </configs>
</datamodel>
`;

const zip = new JSZip();
zip.file('index.xml', INDEX_XML);
zip.file('OL-datamodel.OL-datamodel', DATAMODEL_XML);

const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});

writeFileSync(outPath, buf);
console.log(`Written: ${outPath} (${buf.length} bytes)`);
