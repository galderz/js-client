# Infinispan JS Client Productization

This document aims to describe the productization process of Infinispan JS Client,
and contains notes on used scripts and any prod changes required.
This should help engineers who need to perform productization of this project
in the future.

## The Process Overview

Since 7.0.x, JDG contains two NPM projects:
  * jdg-management-console, and
  * js-client
 
Productization of NPM projects tricky because Brew has no support for NPM,
so there is a Maven wrapper *(pom.xml)*, which is executed in Brew as a Maven project.

In addition, however, you need to generate an *npm-shrinkwrap.json* file to lock versions to ensure build reproducibility.
Using just *package.json* is not enough, since the versions can be specified using version ranges.

This is done by first installing all dependencies of the project using `npm install`
and then running `npm shrinkwrap` (see https://docs.npmjs.com/cli/shrinkwrap ).

Be careful, this has to be done *every time upstream changes some dependency* in *package.json*,

After you generate the shrinkwrap, you need to remove all "resolved" fields from the *npm-shrinkwrap.json* file,
but vdedik  modified pom.xml to do this automatically when you run `mvn package`.
You just need to commit the modified `npm-shrinkwrap.json` after first running `mvn package`
locally.

## Detailed Steps (Manual Build)

* Make sure that all changes are integrated
* Update and commit the version in pom.xml, and the following properties:
  * jdgVersion, e.g 7.1.0
  * buildSuffix, e.g. ER1
  * rebuild, e.g 1
* Make sure that the version is consistent with the above. For package.json and productization/npm-shrinkwrap.json
  it is enough that x.y.z is the same (e.g. 0.3.0), the suffix is applied automatically.
* Maven command for local build: `mvn -s productization/maven-settings.xml clean package -DskipTests`
  * What this does:
    * Sets up local node and npm    
    * Installs dependencies using npm
    * Updates versions in package.json
    * Generates shrinkwrap file and fails the build if its different from productization/npm-shrinkwrap.json
    * Generates jsdoc
    * Packages the code using assembly plugin

## Change Log (LIFO)

* *jsenko:* Fail the build if npm-shrinkwrap.json changed
* *jsenko:* Moved and deprecated build.sh, because it's not used in Brew, and it's more appropriate
            to use vanilla maven command.
* *jsenko:* Some of the notes courtesy vdedik.
* *jsenko:* Moved some of the stuff to /productization directory, to keep it clean.
            Ideally, everything regarding prod should be placed there (except the pom.xml).
