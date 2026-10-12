import test from "node:test";
import assert from "node:assert/strict";
import { imageLicenseUrl } from "../shared/image-license";

test("image attribution links the exact CC version or selected file permission statement", () => {
  for (const version of ["2.0", "3.0", "4.0"]) {
    assert.equal(
      imageLicenseUrl(`CC BY-SA ${version}`, ""),
      `https://creativecommons.org/licenses/by-sa/${version}/`,
    );
    assert.equal(
      imageLicenseUrl(`CC BY ${version}`, ""),
      `https://creativecommons.org/licenses/by/${version}/`,
    );
  }
  assert.equal(
    imageLicenseUrl("CC0 1.0", ""),
    "https://creativecommons.org/publicdomain/zero/1.0/",
  );
  const source = "https://commons.wikimedia.org/wiki/File:Selected.jpg";
  assert.equal(
    imageLicenseUrl("Attribution permission (James G. Howes)", source),
    `${source}#Licensing`,
  );
  assert.equal(
    imageLicenseUrl("Public domain (author release)", source),
    `${source}#Licensing`,
  );
  assert.equal(imageLicenseUrl("PHASM original illustration", ""), null);
  assert.equal(imageLicenseUrl("Unknown", source), null);
  assert.equal(
    imageLicenseUrl("Public domain (author release)", "javascript:alert(1)"),
    null,
  );
});
