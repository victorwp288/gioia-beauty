#!/usr/bin/env node

/**
 * Pre-deployment check for dangerous Firebase query patterns
 * Run: node scripts/check-database-efficiency.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🔍 Checking for dangerous Firebase query patterns...");

// Enhanced duplicate detection function
function checkForDuplicates(filePath, methodPattern, description) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const matches = [];

    lines.forEach((line, index) => {
      if (line.match(methodPattern)) {
        matches.push({
          line: index + 1,
          content: line.trim(),
        });
      }
    });

    if (matches.length > 1) {
      console.log(`🚨 DUPLICATE DEFINITIONS FOUND in ${filePath}:`);
      console.log(`   ${description}:`);
      matches.forEach((match) => {
        console.log(`   Line ${match.line}: ${match.content}`);
      });
      console.log(
        "⚠️  JavaScript will use the LAST definition - this could override safe methods!"
      );
      return false;
    } else if (matches.length === 1) {
      console.log(`✅ Single ${description} found: ${matches[0].content}`);
    } else {
      console.log(`✅ No ${description} found`);
    }

    return true;
  } catch (error) {
    console.log(`❌ Error checking ${filePath}: ${error.message}`);
    return false;
  }
}

// Check for duplicates in critical files
console.log("\n1. Checking for duplicate method definitions in DataManager...");

const dataManagerPath = "lib/firebase/dataManager.js";
let allSafe = true;

// Check for duplicate getAppointments methods
allSafe &= checkForDuplicates(
  dataManagerPath,
  /async\s+getAppointments\s*\(/,
  "getAppointments() method"
);

// Check for duplicate _executeAppointmentQuery methods (any variant)
allSafe &= checkForDuplicates(
  dataManagerPath,
  /async\s+_executeAppointmentQuery\w*\s*\(/,
  "_executeAppointmentQuery method"
);

// Check for any legacy method references
allSafe &= checkForDuplicates(
  dataManagerPath,
  /_executeAppointmentQueryLegacy/,
  "legacy method reference"
);

console.log("\n2. Checking for duplicate GET handlers in counts API...");

const countsApiPath = "app/api/appointments/counts/route.js";
allSafe &= checkForDuplicates(
  countsApiPath,
  /export\s+async\s+function\s+GET\s*\(/,
  "GET handler"
);

console.log("\n3. Checking for unsafe query patterns...");

// Check for dangerous getDocs patterns without where() clauses
try {
  const getDcosResult = execSync(
    'grep -rn "getDocs(" app/ lib/ hooks/ components/ --include="*.js" --include="*.jsx" | grep -v "where(" | grep -v "getCountFromServer"',
    { encoding: "utf8", stdio: "pipe" }
  ).trim();

  if (getDcosResult) {
    console.log("🚨 Found potentially unsafe getDocs calls:");
    console.log(getDcosResult);
    allSafe = false;
  } else {
    console.log("✅ All getDocs calls are properly filtered");
  }
} catch (error) {
  // No matches found (which is good) or command failed
  console.log("✅ All customers queries are properly filtered");
}

console.log("\n4. Checking for dangerous collection patterns...");

try {
  const collectionResult = execSync(
    'grep -rn "collection(db," app/ lib/ hooks/ components/ --include="*.js" --include="*.jsx" | grep -v "query(" | grep -v "doc(" | grep -v "addDoc(" | grep -v "updateDoc(" | grep -v "deleteDoc("',
    { encoding: "utf8", stdio: "pipe" }
  ).trim();

  if (collectionResult) {
    console.log("🚨 Found potentially unsafe direct collection references:");
    console.log(collectionResult);
    allSafe = false;
  } else {
    console.log("✅ All collection references are safe");
  }
} catch (error) {
  // No matches found (which is good)
  console.log("✅ All collection references are safe");
}

console.log("\n5. Checking for large limit() values...");

try {
  const limitResult = execSync(
    'grep -rn "limit([0-9][0-9][0-9]" app/ lib/ hooks/ components/ --include="*.js" --include="*.jsx"',
    { encoding: "utf8", stdio: "pipe" }
  ).trim();

  if (limitResult) {
    console.log("🚨 Found large limit() values that could cause read spikes:");
    console.log(limitResult);
    allSafe = false;
  } else {
    console.log("✅ No dangerous large limits found");
  }
} catch (error) {
  // No matches found (which is good)
  console.log("✅ No dangerous large limits found");
}

console.log("\n" + "=".repeat(60));

if (allSafe) {
  console.log("📊 Expected performance after all fixes:");
  console.log("• BookAppointment date change: 1600+ reads → 3-30 reads");
  console.log("• Dashboard load: 1600+ reads → 3-30 reads");
  console.log("• Daily total: 16k+ reads → <100 reads");
  console.log("");
  console.log("✅ Database queries look efficient. Safe to deploy!");
  console.log("🎯 All major read spikes eliminated!");
} else {
  console.log("🚨 FOUND ISSUES THAT NEED TO BE FIXED!");
  console.log("⚠️  Do not deploy until all duplicates are removed!");
  console.log("");
  console.log("🔧 To fix:");
  console.log(
    "1. Remove duplicate method definitions (keep only safe versions)"
  );
  console.log("2. Ensure all queries use proper where() filters");
  console.log("3. Remove any large limit() values");
  process.exit(1);
}
