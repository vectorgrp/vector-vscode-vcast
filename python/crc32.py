
import os
import sys

# See the comment in: executeVPythonScript()
print ("ACTUAL-DATA")

try:
    # only vcast 23 and higher have pychksum
    import pycksum
except:
    print ("NOT-AVAILABLE")
    sys.exit (0)


def main ():
   
    if len (sys.argv)==1:
        # no filePath means the caller is just checking if pycksum is available
        print ("AVAILABLE")
    elif (os.path.exists (sys.argv[1])):
        print (pycksum.cksum(open(sys.argv[1], 'rb')))
    else:
        print (0)

if __name__ == "__main__":
    main()


