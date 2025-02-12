// ==UserScript==
  //@author      sdjrice jewe11
  //@description A JavaScript modification for the Canvas learning management system which adds the ability to message the observers of students on the Inbox and Gradebook/Marksbook pages.
  //@name        Message Observers
  //@require     http://code.jquery.com/jquery-1.7.2.min.js
  //@namespace   msgObs
  //@include     https://uview.test.instructure.com/*
  //@include     https://uview.instructure.com/*
  //@version     vAlpha
  //@grant       none
// ==/UserScript==

let msgobs = {
  options: {
    colour: "bisque", // colour for observers. Use any HTML colour like '#FF0000' or 'red'
    observersText: "Include Observers", // include observers button text.
    removeText: "Remove Students", //  remove students button text.
    busyText: "Working...", // text to display while observers are being processed.
    btnWidth: "110px",
    autoTickIndividualMsgCheckbox: true,
    log: false // output log in the browser console.
  },

  init: () => {
    // init for conversations page (inbox) or gradebook page
    if (
      window.location.href.indexOf("/conversations") !== -1 &&
      this.conversations
    ) {
      msgobs.log("Launching Conversations");
      this.launch("conversations");
    } else if (
      window.location.href.indexOf("/gradebook") !== -1 &&
      this.gradebook
    ) {
      msgobs.log("Launching Gradebook");
      this.launch("gbook");
    }
  },

  launch: type => {
    console.info(
      `%c${ENV.current_user.display_name} is currently running the messageObservers application`,
      "color: #fcba03"
    );

    this.common.init();

    switch (type) {
      case "conversations":
        this.conversations.init();
        break;
      case "gbook":
        this.gradebook.init();
        break;
    }
  },

  common: {
    els: {
      flashMessage: $("#flash_message_holder") // Canvas message flasher (appears top center of screen-ish).
    },
    txt: {
      noStudents: "There are no students in the recipient list.",
      noStudentsRmv: "There are no students in the recipient list.",
      addObsSuccess: "Observers added successfully.",
      addObsNone: "No observers were found.",
      removedStudents: "Removed students.",
      noRecipients: "There are no recipients in the addressee field.",
      noContext:
        "Notice: You have not selected a course context for your search. The observer lookup may take some time and will include observer matches from <strong>all courses.</strong>",
      noContextRmv:
        "Notice: You have not selected a course context for your search. The removal lookup will remove recipients who have a student enrolment in <strong>any course.</strong>",
      noNewObservers:
        "The recipient list already included all matched observers.",
      groupExpansion:
        "Your recipient list contains groups. Groups will be expanded into their respective members."
    },

    init: () => {
      // create button objects with classes from default Canvas buttons. May need classes updated in the future.
      this.btnAddObs = $("<div>" + msgobs.options.observersText + "</div>")
        .addClass(
          "ui-button ui-widget ui-state-default ui-corner-all ui-button-text-only"
        )
        .css({
          margin: "0 2px",
          "min-width": msgobs.options.btnWidth
        });
      this.btnRmvStu = $("<div>" + msgobs.options.removeText + "</div>")
        .addClass(
          "ui-button ui-widget ui-state-default ui-corner-all ui-button-text-only"
        )
        .css({
          margin: "0 2px",
          "min-width": msgobs.options.btnWidth
        });
    },

    getCsrfToken: () => {
      // returns secret cookie token
      let csrfToken = document.cookie.slice(
        document.cookie.indexOf("_csrf_token=") + 12
      );
      if (csrfToken.indexOf(";") !== -1) {
        // depending on the order of the cookie lets the csrf may be at end of string. Therefore, there will be no semicolon. Chrome.
        csrfToken = csrfToken.slice(0, csrfToken.indexOf(";"));
      }
      return csrfToken;
    },

    searchObjArray: (arr, search) => {
      let match = -1;
      arr.forEach((item, i) => {
        for (let key in item) {
          if (item[key] === search) {
            match = i;
          }
        }
      });
      return match; // for consistency with indexOf comparisons
    },

    getEnrolmentsRecursively: {
      Enrolments: (callback, resultsObj) => {
        this.complete = callback;
        this.recursiveResults = [];
        this.resultsObj = resultsObj;
      },

      init: (options, callback, results) => {
        let enrolments = new this.Enrolments(callback, results);
        let operator = options.query.indexOf("?") !== -1 ? "&" : "?";
        msgobs.xhr.get(
          "/api/v1/" +
            options.mode +
            "/" +
            options.id +
            "/" +
            options.query +
            operator +
            "per_page=100" +
            options.type,
          this.proc,
          enrolments
        );
      },

      proc: (res, status, enrolments, link) => {
        let ctx = msgobs.common.getEnrolmentsRecursively;

        if (res.forEach) {
          res.forEach(v => {
            enrolments.recursiveResults.push(v);
          });
        } else {
          enrolments.recursiveResults.push(res);
        }

        if (link && link.indexOf("next") !== -1) {
          // is there a next page?
          let next = ctx.parseNextLink(link); // get the next link
          msgobs.xhr.get(next, ctx.proc, enrolments); // get the next page
        } else {
          enrolments.complete(
            enrolments.recursiveResults,
            status,
            enrolments.resultsObj
          );
        }
      },

      parseNextLink: link => {
        link = link.match(/,<.*>;.rel="next"/);
        link = link[0].match(/<.*>/);
        link = link[0].replace(/<|>/g, "");
        return link;
      }
    },

    getObservers: {
      init: (recipients, context, callback) => {
        msgobs.log("--Observers 2.0--");

        function Observers() {
          this.contexts = [context];
          this.contexts.count = 0;
          this.contexts.total = 0;

          this.contexts.getCount = 0;

          this.expand = [];
          this.expand.count = 0;
          this.expand.total = 0;

          this.users = [];
          this.users.simplified = [];

          this.enrolments = [];

          this.observers = [];

          this.callback = callback;

          this.matchFlag = 0;
        }

        let results = new Observers();

        this.sortRecipients(recipients, results);
        this.process.init(results);
      },

      sortRecipients(recipients, results) {
        recipients.forEach(id => {
          id = id.split("_");

          switch (id.length) {
            case 1:
              // user id
              results.expand.push(["user", id[0]]);
              break;
            case 2:
              // course, section
              results.expand.push([id[0], id[1]]);
              break;
            case 3:
              // course, section, type
              results.expand.push([id[0], id[1], id[2]]);
              break;
          }
        });
      },

      process: {
        init: results => {
          msgobs.log(results);
          this.expand(results);
          results.expand.total = results.expand.length;
        },

        handle: (data, status, results) => {
          results.expand.count++;
          if (data.forEach) {
            data.forEach(v => {
              if (v.user) {
                results.users.push(v.user);
              } else {
                results.users.push(v);
              }
            });
          } else {
            results.users.push(data);
          }

          msgobs.log(
            "Expand count: " +
              results.expand.count +
              " Total: " +
              results.users.length
          );

          if (results.expand.count === results.expand.total) {
            results.users.forEach(v => {
              results.users.simplified.push({
                id: v.id,
                name: v.name
              });
            });
            msgobs.common.getObservers.process.lookup.init(results);
          }
        },

        expand: results => {
          let callback = this.handle;
          results.expand.forEach(v => {
            let type = "";

            if (v[2]) {
              type = v[2].slice(0, v[2].length - 1); // remove plural
              type = "&enrollment_type=" + type;
            }

            // at some point this will need to be made per user
            let options = false;

            switch (v[0]) {
              case "user":
                if (results.contexts[0] === "none") {
                  options = {
                    mode: "users",
                    id: v[1],
                    query: "",
                    type: ""
                  };
                } else {
                  options = {
                    mode: "courses",
                    id: results.contexts[0],
                    query: "search_users?search_term=" + v[1],
                    type: ""
                  };
                }
                break;
              case "course":
                options = {
                  mode: "courses",
                  id: v[1],
                  query: "users",
                  type: type
                };
                break;
              case "section":
                options = {
                  mode: "sections",
                  id: v[1],
                  query: "enrollments",
                  type: ""
                };
                break;
              case "group":
                options = {
                  mode: "groups",
                  id: v[1],
                  query: "users",
                  type: ""
                };
                break;
            }
            msgobs.common.getEnrolmentsRecursively.init(
              options,
              callback,
              results
            );
          });
        },

        lookup: {
          init: results => {
            msgobs.log("--- Getting Enrollments ---");
            results.contexts.total = results.contexts.length;
            if (results.contexts[0] === "none") {
              results.contexts.pop();
              this.getContexts.init(results);
            } else {
              this.enrolments(results);
            }
          },

          getContexts: {
            init: results => {
              msgobs.log(
                "No context for lookup, getting contexts from user enrolments."
              );
              results.contexts.getCount = 0;
              this.contexts(results);
            },

            contexts: results => {
              let callback = this.handle;
              results.users.forEach(v => {
                let options = {
                  mode: "users",
                  id: v.id,
                  query: "enrollments?state=active",
                  type: ""
                };
                msgobs.common.getEnrolmentsRecursively.init(
                  options,
                  callback,
                  results
                );
              });
            },

            handle: (data, status, results) => {
              results.contexts.getCount++;
              data.forEach(v => {
                if (results.contexts.indexOf(v.course_id) === -1) {
                  // don't make duplicates
                  results.contexts.push(v.course_id);
                }
              });
              msgobs.log(
                "getContextCount: " +
                  results.contexts.getCount +
                  " Total: " +
                  results.users.length
              );
              if (results.contexts.getCount === results.users.length) {
                msgobs.log("Context lookup complete.");
                msgobs.common.getObservers.process.lookup.init(results);
              }
            }
          },

          enrolments: results => {
            let callback = this.handle;
            results.contexts.forEach(v => {
              let options = {
                mode: "courses",
                id: v,
                query: "enrollments",
                type: ""
              };
              msgobs.common.getEnrolmentsRecursively.init(
                options,
                callback,
                results
              );
            });
          },

          handle: (data, status, results) => {
            results.contexts.count++;
            data.forEach(v => {
              if (v.associated_user_id) {
                results.enrolments.push(v);
              }
            });

            msgobs.log(
              "Enrolments Count: " +
                results.contexts.count +
                "Total: " +
                results.contexts.total
            );

            if (results.contexts.count === results.contexts.total) {
              msgobs.log("Completed enrolments lookup");
              msgobs.common.getObservers.process.match.init(results);
            }
          }
        },

        match: {
          init: results => {
            msgobs.log("--- Matching Results ---");
            this.match(results);
          },

          match: results => {
            results.users.forEach(user => {
              results.enrolments.forEach(enrolment => {
                msgobs.log(
                  "Comparing: " +
                    user.id +
                    " <-> " +
                    enrolment.associated_user_id
                );
                if (user.id === enrolment.associated_user_id) {
                  msgobs.log("Found a match.");
                  results.matchFlag = 1;
                  let observerData = {
                    id: enrolment.user_id,
                    name: enrolment.user.name,
                    observing: user.name
                  };
                  // omit duplicate entries, add additional observees to existing entry.
                  let observerDuplicate = msgobs.common.searchObjArray(
                    results.observers,
                    observerData.id
                  );

                  // below is a probably pointless check
                  // let userDuplicate = msgobs.common.searchObjArray(results.users.simplified, user.id);
                  let userObserverDuplicate = msgobs.common.searchObjArray(
                    results.users.simplified,
                    observerData.id
                  );
                  if (
                    observerDuplicate === -1 &&
                    userObserverDuplicate === -1
                  ) {
                    results.observers.push(observerData);
                  } else if (observerDuplicate > -1) {
                    if (
                      results.observers[observerDuplicate].observing.indexOf(
                        user.name
                      ) === -1
                    ) {
                      results.observers[observerDuplicate].observing +=
                        ", " + user.name;
                    }
                  }
                }
              });
            });

            msgobs.common.getObservers.complete(results);
          }
        }
      },
      complete: results => {
        // maybe return the whole object, eh?
        results.callback([
          results.observers,
          results.users.simplified,
          results.matchFlag
        ]);
      }
    },

    // old lookup methods below. Still used in gradebook lookups.
    getEnrolments: (id, mode, returnCallback) => {
      function CollatedEnrolments() {
        this.total = id.length;
        this.count = 0;
        this.enrolments = [];
      }

      let collatedEnrolments = new CollatedEnrolments();

      let callback = data => {
        // add each result to enrolments result object
        collatedEnrolments.enrolments.push(data);
        collatedEnrolments.count++;
        if (collatedEnrolments.count >= collatedEnrolments.total) {
          // oncomplete, call callback function.
          let enrolments = [];
          collatedEnrolments.enrolments.forEach(v => {
            enrolments = enrolments.concat(v);
          });
          returnCallback(enrolments);
        }
      };

      if (id.forEach) {
        id.forEach(v => {
          let options = {
            mode: mode,
            id: v,
            query: "enrollments",
            type: ""
          };

          msgobs.common.getEnrolmentsRecursively.init(options, callback);
        });
      }
    },

    getCourseSections: (courseId, callback) => {
      let handle = function(data) {
        let sections = [];
        data.forEach(v => {
          if (sections.indexOf(v.id) === -1) {
            sections.push(v.id);
          }
        });
        callback(sections);
      };
      msgobs.xhr.get(
        "/api/v1/courses/" + courseId + "/sections?per_page=100000",
        handle
      );
    },

    getMatchedObservers: (ids, enrolments) => {
      // returns associated_users given an array of ids (of students)
      let observerIds = [];
      let inserted = [];
      enrolments.forEach(enrolment => {
        // act on observers with associated_user_id specified
        if (
          enrolment.type === "ObserverEnrollment" &&
          enrolment.associated_user_id !== null
        ) {
          ids.forEach(v => {
            // compare with given id list
            if (enrolment.associated_user_id == v.id) {
              let observerData = {
                id: enrolment.user_id,
                name: enrolment.user.name,
                observing: v.name
              };
              // omit duplicate entries, add additional observees to existing entry.
              let duplicate = inserted.indexOf(observerData.id);
              if (duplicate === -1) {
                observerIds.push(observerData);
                inserted.push(observerData.id);
              } else {
                if (observerIds[duplicate].observing.indexOf(v.name) === -1) {
                  observerIds[duplicate].observing += ", " + v.name;
                }
              }
            }
          });
        }
      });

      return observerIds;
    },

    notify: (msg, type) => {
      let time = new Date();
      time = time.getMilliseconds();
      let msgSuccess = $(
        '<li id="msgobs-notification-' +
          time +
          '" class="ic-flash-' +
          type +
          '" aria-hidden="true" style="z-index: 2; margin-top: 7px;"><div class="ic-flash__icon"><i class="icon"></i></div>' +
          msg +
          '<button type="button" class="Button Button--icon-action close_link"><i class="icon-x"></i></button></li>'
      );
      this.els.flashMessage.append(msgSuccess);
      // remove the message after a 5 secs.
      setTimeout(() => {
        $("#msgobs-notification-" + time).fadeOut(() => {
          $(this).remove();
        });
      }, 5000);
    }
  },

  conversations: {
    runOnce: 0,
    step: 0,
    els: {
      dialog: ".compose-message-dialog",
      btnContainer: ".attachments",
      courseId: "input[name=context_code]",
      recipientList: ".ac-token-list",
      recipientEl: ".ac-token"
    },
    init: () => {
      let ctx = this;
      // set bindings for buttons
      let messagebox = document.getElementsByTagName("body");
      msgobs.common.btnAddObs.bind("click", () => {
        msgobs.conversations.getObserversInit();
      });

      msgobs.common.btnRmvStu.bind("click", () => {
        msgobs.conversations.removeStudentsInit();
      });

      // Some elements are loaded dynamaically after the page load. Loop to test
      // whether they're there yet. Previously used a mutationobserver.

      let readyCheck = function(callback) {
        if ($(msgobs.conversations.els.dialog).length) {
          msgobs.log(msgobs.conversations.els.dialog + " found.");
          msgobs.conversations.insertUi();
        } else {
          msgobs.log(msgobs.conversations.els.dialog + " element not ready.");
          setTimeout(() => {
            callback(callback);
          }, 500);
        }
      };
      readyCheck(readyCheck);
    },

    insertUi: () => {
      if (
        window.ENV.current_user_roles.indexOf("teacher") !== -1 ||
        window.ENV.current_user_roles.indexOf("admin") !== -1
      ) {
        $(this.els.btnContainer, this.els.dialog).append(
          msgobs.common.btnAddObs,
          msgobs.common.btnRmvStu
        );
        msgobs.log("Teacher/Admin role detected. UI inserted.");
      } else {
        msgobs.log("No teacher/admin role detected.");
        msgobs.log(window.ENV.current_user_roles);
      }

      this.autoCheck();
    },

    autoCheck: () => {
      // check the tickbox for individual messages.
      if (msgobs.options.autoTickIndividualMsgCheckbox) {
        $("#compose-btn").on("click", () => {
          setTimeout(() => {
            if ($("#bulk_message").length) {
              $("#bulk_message").prop("checked", true);
            } else {
              msgobs.conversations.autoCheck();
            }
          }, 50);
        });
      }
    },

    setMode: () => {
      this.courseID = $(this.els.courseId, this.dialog).attr("value");
      if (this.courseID.indexOf("course_") !== -1) {
        this.courseID = this.courseID.replace("course_", "");
        this.mode = "course";
      } else {
        this.mode = "user";
      }
      msgobs.log("Mode: " + this.mode);
      msgobs.log("Course_ID: " + this.CourseID);
    },

    getObserversInit: () => {
      msgobs.log("Getting Observers Init..");
      this.step = 0;
      this.mode = "";

      let recipients = this.getRecipientIds();
      if (!recipients.length) {
        msgobs.common.notify(msgobs.common.txt.noRecipients, "warning");
      } else {
        this.setMode(); // set whether a course context has been selected
        this.getObservers(); // start!
      }
    },

    getObservers: data => {
      this.step++;
      msgobs.log("-----------------");
      msgobs.log("GetObservers Mode: [" + this.mode + "] Step: " + this.step);

      let callback = function getObservers(data) {
        msgobs.log("Returning to original Caller..");
        msgobs.conversations.getObservers(data);
      };

      let recipients = [];
      this.getRecipientIds().forEach(v => {
        recipients.push(v.id);
      });

      switch (this.step) {
        case 1:
          let context;
          if (this.mode === "user") {
            context = "none";
            msgobs.common.notify(msgobs.common.txt.noContext, "success");
          } else {
            context = this.courseID;
          }

          let hasGroups = 0;
          recipients.forEach(v => {
            if (
              v.indexOf("course") !== -1 ||
              v.indexOf("group") !== -1 ||
              v.indexOf("section") !== -1
            ) {
              hasGroups = 1;
            }
          });

          if (hasGroups) {
            msgobs.common.notify(msgobs.common.txt.groupExpansion, "success");
          }

          msgobs.common.btnAddObs
            .addClass("disabled")
            .text(msgobs.options.busyText);
          msgobs.common.btnRmvStu.addClass("disabled");
          msgobs.common.getObservers.init(recipients, context, callback);

          break;
        case 2:
          let observers = data[0];
          let users = data[1];
          let matchFlag = data[2];
          msgobs.log(observers);
          // complete!
          if (observers.length || users.length) {
            msgobs.conversations.clear(observers.concat(users));
            users.forEach(v => {
              msgobs.conversations.insert(v, false);
            });
            observers.forEach(v => {
              msgobs.conversations.insert(v, true);
            });

            if (users.length && !observers.length && matchFlag) {
              msgobs.common.notify(msgobs.common.txt.noNewObservers, "success");
            }

            if (users.length && !observers.length && !matchFlag) {
              msgobs.common.notify(msgobs.common.txt.addObsNone, "warning");
              msgobs.log("No observers found");
            }

            if (observers.length) {
              msgobs.common.notify(msgobs.common.txt.addObsSuccess, "success");
            }
            msgobs.log("Inserted results.");
          } else {
            msgobs.common.notify(msgobs.common.txt.addObsNone, "warning");
            msgobs.log("No observers found");
          }
          msgobs.common.btnRmvStu.removeClass("disabled");
          msgobs.common.btnAddObs
            .removeClass("disabled")
            .text(msgobs.options.observersText);
          break;
      }
    },

    getRecipientIds: () => {
      // return recipients from list element
      let recipients = [];
      $(this.els.recipientEl, this.els.dialog).each((index, obj) => {
        recipients.push({
          id: $("input", obj).attr("value"),
          name: $(obj).text()
        });
      });
      return recipients;
    },

    clear: arr => {
      $(this.els.recipientList, this.els.dialog).empty();
    },

    insert: (user, observer) => {
      // add a list item, might need to update these classes occasionally.
      if (observer) {
        let obj = $(
          '<li class="ac-token" title="Linked to: ' +
            user.observing +
            '" data-type="observer" style="background-color:' +
            msgobs.options.colour +
            '; border-color: rgba(0,0,0,0.10);">' +
            user.name +
            '<a href="#" class="ac-token-remove-btn"><i class="icon-x icon-messageRecipient--cancel"></i><span class="screenreader-only">Remove recipient ' +
            user.name +
            '</span></a><input name="recipients[]" value="' +
            user.id +
            '" type="hidden"></li>'
        );
      } else {
        let obj = $(
          '<li class="ac-token" data-type="user" style="border-color: rgba(0,0,0,0.10);">' +
            user.name +
            '<a href="#" class="ac-token-remove-btn"><i class="icon-x icon-messageRecipient--cancel"></i><span class="screenreader-only">Remove recipient ' +
            user.name +
            '</span></a><input name="recipients[]" value="' +
            user.id +
            '" type="hidden"></li>'
        );
      }
      $(this.els.recipientList, this.els.dialog).append(obj);
    },

    removeStudentsInit: () => {
      // remove students. Unfortunately also needs an api lookup since user roles
      // don't appear to be associated with list items.
      msgobs.log("Removing Students");
      this.removeStep = 0;
      this.setMode();
      this.removeStudents();
    },

    removeStudents: data => {
      let ctx = this;
      this.removeStep++;
      msgobs.log("------------------------");
      msgobs.log(
        "Remove Students Mode: [" + this.mode + "] Step: " + this.removeStep
      );

      let callback = result => {
        msgobs.conversations.removeStudents(result);
      };

      let recipients, removal;

      switch (this.mode) {
        case "user":
          switch (this.removeStep) {
            case 1:
              msgobs.common.notify(msgobs.common.txt.noContextRmv, "success");
              // look up user enrolments.
              if (this.getRecipientIds().length) {
                msgobs.common.btnAddObs.addClass("disabled");
                msgobs.common.btnRmvStu
                  .addClass("disabled")
                  .text(msgobs.options.busyText);
                recipients = this.getRecipientIds();
                let ids = [];
                recipients.forEach(v => {
                  ids.push(v.id);
                });
                msgobs.log("Getting Enrolments for users.");
                msgobs.common.getEnrolments(ids, "users", callback);
              } else {
                msgobs.common.notify(
                  msgobs.common.txt.noStudentsRmv,
                  "warning"
                );
              }
              break;
            case 2:
              // process for enrolment type.
              msgobs.log("User Enrolments:");
              msgobs.log(data);
              recipients = this.getRecipientIds();
              msgobs.log("Recipient IDs:");
              msgobs.log(recipients);

              // Where users have a students enrolmentType, queue for removal
              removal = [];
              recipients.forEach(v => {
                let enrolmentType = ctx.getEnrolmentStatus(v.id, data);
                if (enrolmentType.indexOf("StudentEnrollment") !== -1) {
                  removal.push(v.id);
                }
              });
              // remove matched StudentEnrollment ids.
              msgobs.log("Matched StudentEnrollment removal IDs:");
              msgobs.log(removal);
              this.removeById(removal);
              msgobs.common.btnRmvStu
                .removeClass("disabled")
                .text(msgobs.options.removeText);
              msgobs.common.btnAddObs.removeClass("disabled");
              break;
          }
          break;
        case "course":
          switch (this.removeStep) {
            case 1:
              // lookup course enrolments.
              if (this.getRecipientIds().length) {
                msgobs.common.btnRmvStu
                  .addClass("disabled")
                  .text(msgobs.options.busyText);
                msgobs.common.btnAddObs.addClass("disabled");
                msgobs.log("Getting Enrolments for users.");
                msgobs.common.getEnrolments(
                  [this.courseID],
                  "courses",
                  callback
                );
              } else {
                msgobs.common.notify(
                  msgobs.common.txt.noStudentsRmv,
                  "warning"
                );
              }
              // now that I look at this, I think it's missing sections. Probably should fix that soon.
              break;
            case 2:
              msgobs.log("Course Enrolments: ");
              msgobs.log(data);
              this.courseEnrolments = data;
              msgobs.log("Getting course sections:");
              msgobs.common.getCourseSections(this.courseID, callback);
              break;
            case 3:
              msgobs.log("Course Sections: ");
              msgobs.log(data);
              msgobs.common.getEnrolments(data, "sections", callback);
              break;
            case 4:
              enrolments = this.courseEnrolments.concat(data);

              msgobs.log("All Enrolments: ");
              msgobs.log(data);
              recipients = this.getRecipientIds();
              removal = [];
              recipients.forEach(v => {
                let enrolmentType = ctx.getEnrolmentStatus(v.id, enrolments);
                if (enrolmentType.indexOf("StudentEnrollment") !== -1) {
                  removal.push(v.id);
                }
              });
              msgobs.log("Matched StudentEnrollment removal IDs:");
              msgobs.log(removal);
              this.removeById(removal);
              msgobs.common.btnRmvStu
                .removeClass("disabled")
                .text(msgobs.options.removeText);
              msgobs.common.btnAddObs.removeClass("disabled");
              break;
          }
          break;
      }
    },

    removeById: removal => {
      // remove ids from list element given an array of ids.
      let removed = false;
      $(this.els.recipientEl, this.els.dialog).each((index, obj) => {
        let id = $("input", obj).attr("value");
        if (removal.indexOf(id) !== -1) {
          $(this).remove();
          removed = true;
        }
      });

      if (removed) {
        msgobs.common.notify(msgobs.common.txt.removedStudents, "success");
      } else {
        msgobs.common.notify(msgobs.common.txt.noStudentsRmv, "warning");
      }
    },

    getEnrolmentStatus: (user, enrolments) => {
      let type = [];
      enrolments.forEach(v => {
        if (v.user_id == user) {
          type.push(v.type);
        }
      });
      return type;
    }
  },

  gradebook: {
    messageSent: false,
    step: 0,
    runOnce: 0,
    els: {
      gradetable: document.getElementById("gradebook-grid-wrapper"), // container for grades, monitored for mutations
      dialog: "#message_students_dialog", // container for message box
      bodyClassCoursePrefix: "context-course_", // prefix for course context code found in body class
      btnContainer: $(".button-container", "#message_students_dialog"), // msgbox button container
      inputMessageTypes: $(".message_types", "#message_students_dialog"), // student criteria dropdown
      inputScoreCutoff: $(".cutoff_holder", "#message_students_dialog"), // when score criteria is selected, input for no. val appears
      inputFormFields: $(
        ".cutoff_holder, #subject, #body",
        "#message_students_dialog"
      ), // all form fields (for validation)
      inputSubject: $("#subject"), // msg subject field
      inputBody: $("#body"), // msg body field
      btnCanvasSend: $(
        ".button-container .send_button",
        "#message_students_dialog"
      ), // default canvas send button
      btnMsgobsSend: $(
        '<div type="submit" class="Button Button--primary send_button disabled msgobs_sender" aria-disabled="true">Send Message</div>'
      ), // replacement button with alternate send action
      btnCanvasClose: ".ui-dialog-titlebar-close", // close button for msgbox
      studentList: $(".student_list", "#message_students_dialog"),
      studentClass: ".student" // class for student list items.
    },

    init: () => {
      msgobs.common.btnAddObs
        .bind("click", () => {
          msgobs.gradebook.getObserversInit();
        })
        .css("float", "left");
      msgobs.common.btnRmvStu
        .bind("click", () => {
          msgobs.gradebook.removeStudents();
        })
        .css("float", "left");

      let courseId = $("body").attr("class");
      courseId = courseId.slice(
        courseId.indexOf(this.els.bodyClassCoursePrefix) +
          this.els.bodyClassCoursePrefix.length
      );
      courseId = courseId.slice(0, courseId.indexOf(" "));
      this.courseId = courseId;

      msgobs.log("Course ID: " + this.courseId);

      // check to see if element is ready for modification.
      let readyCheck = callback => {
        if ($(msgobs.gradebook.els.dialog).length) {
          msgobs.log(msgobs.gradebook.els.dialog + " found.");
          msgobs.gradebook.els.dialog = $(msgobs.gradebook.els.dialog);
          msgobs.gradebook.insertUi();
        } else {
          msgobs.log(msgobs.gradebook.els.dialog + " element not ready.");
          setTimeout(() => {
            callback(callback);
          }, 500);
        }
      };

      readyCheck(readyCheck);
    },

    insertUi: () => {
      if (msgobs.gradebook.runOnce === 0) {
        msgobs.gradebook.runOnce = 1;

        // Action setup
        msgobs.gradebook.els.btnContainer.prepend(
          msgobs.common.btnAddObs,
          msgobs.common.btnRmvStu
        );

        msgobs.gradebook.els.inputMessageTypes.change(() => {
          msgobs.gradebook.removeObservers();
        });

        msgobs.gradebook.els.inputScoreCutoff.bind("keyup", () => {
          msgobs.gradebook.removeObservers();
        });

        msgobs.gradebook.els.inputFormFields.bind("keyup", () => {
          msgobs.gradebook.validate();
        });

        msgobs.gradebook.els.btnMsgobsSend.bind("click", () => {
          msgobs.gradebook.submit();
        });
        msgobs.log("UI Inserted.");
      }
    },

    getObserversInit: () => {
      msgobs.log("--------------------");
      msgobs.log("Getting Observers...");
      this.step = 0;
      this.getObservers();
    },

    getObservers: data => {
      this.step++;
      msgobs.log("--------------------");
      msgobs.log("Gradebook Step: " + msgobs.gradebook.step);

      let callback = result => {
        msgobs.gradebook.getObservers(result);
      };

      switch (this.step) {
        case 1:
          this.removeObservers(); // cleanup previously inserted observers

          // swap buttons to prevent Canvas actions on send click.
          msgobs.gradebook.els.btnCanvasSend.remove();
          msgobs.gradebook.els.btnContainer.append(
            msgobs.gradebook.els.btnMsgobsSend
          );
          msgobs.common.btnAddObs
            .addClass("disabled")
            .text(msgobs.options.busyText);
          msgobs.common.btnRmvStu.addClass("disabled");
          if (!this.getStudentList().length) {
            //  no studetns
            msgobs.common.notify(msgobs.common.txt.noStudents, "warning");
            msgobs.common.btnAddObs
              .removeClass("disabled")
              .text(msgobs.options.observersText);
          } else {
            // Get course enrolments.
            msgobs.log("Course: " + this.courseId);
            msgobs.common.getEnrolments([this.courseId], "courses", callback);
          }
          break;
        case 2:
          // store result of enrolments, get sections of present course.
          msgobs.log("Course Enrolments: ");
          msgobs.log(data);
          // finalise the process

          // concanentate earlier course enrolments with section enrolments.
          let courseEnrolments = data;
          // match student names to ids. Vulnerable to identical names.
          let studentIds = this.getStudentIds(
            this.getStudentList(),
            courseEnrolments
          );
          msgobs.log("Student IDs: ");
          msgobs.log(studentIds);
          // Match user's observing ids to student ids
          let observerIds = msgobs.common.getMatchedObservers(
            studentIds,
            courseEnrolments
          );
          msgobs.log("Matched observers: ");
          msgobs.log(observerIds);
          // insert the tokens to the ui, complete process with feedback.
          this.insert(observerIds);
          msgobs.common.btnAddObs
            .removeClass("disabled")
            .text(msgobs.options.observersText);
          msgobs.common.btnRmvStu.removeClass("disabled");
          msgobs.common.notify(msgobs.common.txt.addObsSuccess, "success");
          break;
      }
    },

    getStudentList: () => {
      // return list of student names from recipient list element.
      let namelist = [];
      let students = $(
        msgobs.gradebook.els.studentClass,
        msgobs.gradebook.els.studentList
      );
      students.each(() => {
        if (
          $(this)
            .attr("style")
            .indexOf("list-item") >= 0
        ) {
          namelist.push({
            name: $(".name", $(this)).text(),
            obj: this
          });
        }
      });
      return namelist;
    },

    getStudentIds: (studentNames, enrolments) => {
      // returns student ids from students names matched with ids found in enrolment data
      let ids = [];
      studentNames.forEach(studentName => {
        enrolments.forEach((enrolment, i) => {
          if (enrolment.user.name == studentName.name) {
            ids.push({
              id: enrolment.user.id,
              name: studentName.name
            });
            $(studentName.obj).attr("data-id", enrolment.user.id);
          }
        });
      });
      return ids;
    },

    insert: list => {
      // insert elements into ui.
      list.forEach(v => {
        let item = $(
          '<li class="parent" data-id="' +
            v.id +
            '" title="Observing: ' +
            v.observing +
            '" style="display: list-item; background-color: ' +
            msgobs.options.colour +
            '; border-color: rgba(0,0,0,0.10);"><span class="name">' +
            v.name +
            '</span><div class="remove-button Button Button--icon-action" title="Remove ' +
            v.name +
            ' from recipients" aria-disabled="false"><i class="icon-x"></i></div></li>'
        );
        $(".remove-button", item).click(() => {
          $(this)
            .parent()
            .remove();
        });
        msgobs.gradebook.els.studentList.append(item);
      });

      this.validate();
    },

    validate: () => {
      // check message readiness and update button state.
      let subject = msgobs.gradebook.els.inputSubject.val();
      let body = msgobs.gradebook.els.inputBody.val();
      let recipients = 0;
      $("li", msgobs.gradebook.els.studentList).each(() => {
        if (
          $(this)
            .attr("style")
            .indexOf("list-item") !== -1
        ) {
          recipients++;
        }
      });

      if (
        subject.length > 0 &&
        body.length > 0 &&
        recipients > 0 &&
        this.messageSent === false
      ) {
        msgobs.gradebook.els.btnMsgobsSend.removeClass("disabled");
      } else {
        msgobs.gradebook.els.btnMsgobsSend.addClass("disabled");
      }
    },

    getRecipients: () => {
      // return list of recipient items from student list element.
      let recipients = [];
      $("li", msgobs.gradebook.els.studentList).each(() => {
        el = $(this);
        // if the item is displayed, it should be part of the message recipients.
        if (el.attr("style").indexOf("list-item") !== -1) {
          recipients.push(el.attr("data-id"));
        }
      });
      return recipients;
    },

    submit: () => {
      msgobs.log("Sending Message...");
      // send the message
      if (this.messageSent === true) {
        return false;
      }

      // Build mega data string. Couldn't get sending JSON object to work :(
      let data = "utf8=%E2%9C%93"; // odd tick character
      data += "&authenticity_token=" + msgobs.common.getCsrfToken();
      data +=
        "&recipients=" + encodeURIComponent(this.getRecipients().toString(","));
      data += "&group_conversation=true";
      data += "&bulk_message=true";
      data += "&context_code=course_" + this.courseId;
      data += "&mode=async";
      data +=
        "&subject=" +
        encodeURIComponent(msgobs.gradebook.els.inputSubject.val());
      data +=
        "&body=" + encodeURIComponent(msgobs.gradebook.els.inputBody.val());
      data += "&_method=post";

      msgobs.log("Data: " + data);

      // oncomplete function
      let callback = (res, status) => {
        msgobs.gradebook.cleanup(true);
        msgobs.gradebook.messageSent = false;
        $(msgobs.gradebook.els.btnCanvasClose).click();
        msgobs.log("XHR Status " + status);
        if (status == "202" || status == "200") {
          msgobs.common.notify("Message sent!", "success");
        } else {
          msgobs.common.notify(
            "An error occured. Your message was not sent.",
            "error"
          );
          alert(
            "An error occured and your message was not sent. Please copy your message below to prevent losing your beautifully crafted dialog!\n\n" +
              msgobs.gradebook.els.inputBody.val()
          );
        }
      };

      msgobs.xhr.post("/api/v1/conversations", data, callback);
      this.messageSent = true;
      this.validate();
    },

    cleanup: silent => {
      msgobs.log("Cleaning up: ");
      this.removeStudents(silent);
      this.removeObservers();
    },

    removeObservers: () => {
      $(".parent", this.els.studentList).remove();
      // put the normal button back because we're not messaging parents anymore.
      msgobs.gradebook.els.btnMsgobsSend.detach();
      msgobs.gradebook.els.btnContainer.append(
        msgobs.gradebook.els.btnCanvasSend
      );
      msgobs.log("Observers removed");
    },

    removeStudents: silent => {
      msgobs.log("Students removed");
      let failed = 1;
      $(".student", msgobs.gradebook.els.dialog).each(() => {
        if (
          $(this)
            .attr("style")
            .indexOf("display: list-item") >= 0
        ) {
          failed = 0;
        }
      });
      if (failed === 1) {
        if (!silent) {
          msgobs.common.notify(msgobs.common.txt.noStudentsRmv, "warning");
        }
      } else {
        $(".student", msgobs.gradebook.els.dialog).attr(
          "style",
          "display: none;"
        );
        if (!silent) {
          msgobs.common.notify(msgobs.common.txt.removedStudents, "success");
        }
      }
    }
  },

  xhr: {
    // xhr stuff. pretty generic
    get: (url, callback, ref) => {
      let req = new XMLHttpRequest();
      msgobs.log("XHR: Url: " + url);
      let handle = () => {
        let res = this.responseText;
        res = JSON.parse(res.replace("while(1);", ""));
        msgobs.log("XHR: Response: ");
        msgobs.log(res);
        callback(res, this.status, ref, this.getResponseHeader("Link"));
      };

      req.onload = handle;
      req.open("GET", url);
      req.send();
    },

    post: (url, data, callback) => {
      let req = new XMLHttpRequest();

      let handle = () => {
        let res = this.responseText;
        let status = this.status;
        res = JSON.parse(res.replace("while(1);", ""));
        callback(res, status);
      };

      req.onload = handle;
      req.open("POST", url, true);
      req.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
      req.send(data);
    }
  },

  logItems: [],
  log: (msg, warn, err) => {
    let date = new Date();

    function zero(str) {
      return str.toString().length < 2 ? "0" + str : str;
    } // derp. no idea how to use dates.

    stamp =
      "[" +
      zero(date.getHours()) +
      ":" +
      zero(date.getMinutes()) +
      ":" +
      zero(date.getSeconds()) +
      "] ";
    if (msgobs.options.log) {
      console.log(stamp + JSON.stringify(msg));
    }
    this.logItems.push(stamp + JSON.stringify(msg));
  },
  applog: () => {
    console.dir(logitems);
  }
};

$(document).ready(() => {
  msgobs.init();
});
