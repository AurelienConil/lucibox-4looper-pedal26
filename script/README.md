# Connect to ssh

ssh patch@patchbox.local

password : raspberry



# Stop services

patch@patchbox(rw):~$ systemctl --user stop lucibox-pd.service
patch@patchbox(rw):~$ systemctl --user stop lucibox-node.service


# Services journal

journalctl --user-unit=lucibox-node.service
journalctl --user-unit=lucibox-node.service --follow

 

